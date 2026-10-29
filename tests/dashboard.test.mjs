import { test } from 'vitest'
import assert from 'node:assert/strict'
import { dashboardTaskPages, dashboardGridLayout, dashboardMemberPath, normalizeDashboardRecords, dashboardTaskState, selectDashboardTasks, dashboardRanks, dashboardScoreboard, dashboardScoreLabel, safeDashboardUrl } from '../utils/dashboard-data.mjs'
import { createDashboardService } from '../utils/dashboard-service.mjs'
import { dashboardFixtures } from './fixtures/dashboard.mjs'

const instant = Date.parse('2027-01-01T00:00:00+08:00')
const env = { DASHBOARD_ENABLED: 'true',
  FEISHU_APP_ID: 'cli_test', FEISHU_APP_SECRET: 'secret-test-only', FEISHU_BITABLE_APP_TOKEN: 'base_test', FEISHU_BITABLE_TABLE_ID: 'tbl_test' }
const context = (options = {}) => ({ env, authenticated: true, request: new Request('https://example.test/api/dashboard'), ...options })
const reply = body => Response.json(body)
const records = dashboardFixtures(instant).records

function upstream(calls = []) {
  return async (url, options = {}) => {
    calls.push({ url: String(url), ...options })
    if (String(url).includes('/auth/')) return reply({ code: 0, tenant_access_token: 'tenant-test-only', expire: 7200 })
    return reply({ code: 0, data: { items: records, has_more: false } })
  }
}

test('飞书字段兼容文章写法，返回白名单字段并按人员标识去重', () => {
  const task = normalizeDashboardRecords([{ record_id: 'record', fields: {
    任务名称: [{ text: '<img src=x onerror=alert(1)>' }], 组别: '机械组', 完成情况: '未完成', 最晚截止日期: instant,
    执行人: [{ id: 'person', name: '张三', email: 'private@example.test', avatar_url: 'javascript:alert(1)' }, { id: 'person', name: '张三' }],
    发布人: { id: 'author', name: '李四' }, 优先级: 'P0-高', 内部资料: 'never-return'
  } }])[0]
  assert.equal(task.title, '<img src=x onerror=alert(1)>')
  assert.equal(task.group, '机械组')
  assert.equal(task.deadline, instant)
  assert.equal(task.priority, 'high')
  assert.deepEqual(task.assignees, [{ key: 'person', name: '张三', avatar: '' }])
  assert.equal(task.publisher, '李四')
  assert(!JSON.stringify(task).includes('private@example.test'))
  assert(!JSON.stringify(task).includes('never-return'))
  assert.equal(safeDashboardUrl('https://user:password@example.test'), '')
})

test('字段映射、错误状态及日期处理，不将错误表格伪装成空待办', () => {
  const input = [{ record_id: 'id', fields: { 标题: '任务', 状态: '已完成' } }]
  assert.equal(normalizeDashboardRecords(input, { title: '标题', status: '状态' })[0].status, 'done')
  assert.throws(() => normalizeDashboardRecords(input, { typo: '标题' }), /INVALID_FIELD_MAP/)
  assert.throws(() => normalizeDashboardRecords([{ record_id: 'id', fields: { 任务名称: '任务', 完成状态: '正在进行' } }]), /INVALID_TASK_STATUS/)
  assert.throws(() => normalizeDashboardRecords([{ record_id: 'id', fields: { 任务名称: '任务', 完成状态: '未完成', 截止时间: 'bad date' } }]), /INVALID_TASK_DATE/)
})

test('空完成状态按未完成展示并标记，已有完成时间和分值也不计分', () => {
  const blanks = [undefined, null, '', '  \n ', []]
  const tasks = normalizeDashboardRecords(blanks.map((value, i) => ({ record_id: `blank-${i}`, fields: {
    任务名称: `空状态任务${i}`, 完成情况: value, 完成时间: instant, 分值: '5', 最晚截止日期: instant - 1,
    执行人: [{ id: 'person', name: '示例成员' }]
  } })))
  assert.equal(tasks.length, blanks.length)
  assert(tasks.every(task => task.status === 'todo' && task.statusMissing === true))
  assert(tasks.every(task => dashboardTaskState(task, instant) === 'overdue'))
  assert.deepEqual(dashboardScoreboard(tasks).rows.map(row => [row.score, row.doneCount]), [[0, 0]])
  const withEmptyFields = normalizeDashboardRecords([{ record_id: 'empty', fields: { 任务名称: '仅标题任务' } }])[0]
  assert.equal(withEmptyFields.deadline, null)
  assert.equal(withEmptyFields.score, null)
  assert.deepEqual(withEmptyFields.assignees, [])
})

test('非空未知状态可单条隔离，布尔或数字等异常格式不能误判为空状态', () => {
  const statusIssues = []
  const invalid = ['进行中', false, 0, {}].map((value, i) => ({ record_id: `invalid-${i}`, fields: {
    任务名称: '状态待确认', 完成情况: value, 内部资料: 'private-never-return'
  } }))
  for (const record of invalid) assert.throws(() => normalizeDashboardRecords([record]), /INVALID_TASK_STATUS/)
  const tasks = normalizeDashboardRecords([...records, ...invalid], {}, { statusIssues })
  assert.equal(tasks.length, records.length)
  assert.equal(statusIssues.length, invalid.length)
  assert.deepEqual(Object.keys(statusIssues[0]).sort(), ['id', 'status', 'title'])
  assert(!JSON.stringify(statusIssues).includes('private-never-return'))
})

test('真实读取链路兼容空状态，隔离未知项并在补填完成后重新计分和清除警告', async () => {
  let time = instant
  const source = [
    { record_id: 'empty-status', fields: { 任务详情: '空状态任务', 分值: '5', 负责人: [{ id: 'a', name: '成员甲' }] } },
    { record_id: 'done', fields: { 任务详情: '完成任务', 完成情况: '已完成', 分值: '3', 负责人: [{ id: 'a', name: '成员甲' }] } },
    { record_id: 'unknown', fields: { 任务详情: '未知状态任务', 完成情况: '待验收', 分值: '99', 负责人: [{ id: 'a', name: '成员甲' }], 内部资料: 'private-never-return' } }
  ]
  const handler = createDashboardService({ now: () => time, fetcher: async url => String(url).includes('/auth/')
    ? reply({ code: 0, tenant_access_token: 'private-token' }) : reply({ code: 0, data: { items: source, has_more: false } }) })
  const config = context({ env: { ...env, FEISHU_FIELD_MAP: JSON.stringify({ title: '任务详情', assignees: '负责人', status: '完成情况' }) } })
  const response = await handler(config)
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.tasks.length, 2)
  assert.equal(body.tasks[0].statusMissing, true)
  assert.deepEqual(body.statusIssues, [{ id: 'unknown', title: '未知状态任务', status: '待验收' }])
  assert.equal(dashboardScoreboard(body.tasks).rows[0].score, 3)
  assert(!JSON.stringify(body).includes('private-never-return'))
  assert(!JSON.stringify(body).includes('private-token'))
  assert.deepEqual((await (await handler(config)).json()).statusIssues, body.statusIssues)
  source[0].fields.完成情况 = '已完成'
  source[2].fields.完成情况 = '未完成'
  time += 31_000
  const repaired = await (await handler(config)).json()
  assert.deepEqual(repaired.statusIssues, [])
  assert.equal(repaired.tasks.length, 3)
  assert.equal(repaired.tasks[0].statusMissing, undefined)
  assert.equal(dashboardScoreboard(repaired.tasks).rows[0].score, 8)
  source[0].fields.完成情况 = null
  time += 31_000
  const reopened = await (await handler(config)).json()
  assert.equal(reopened.tasks[0].statusMissing, true)
  assert.equal(dashboardScoreboard(reopened.tasks).rows[0].score, 3)
})

test('全部状态未知仍明确报错并给出白名单诊断，全部空状态可正常展示', async () => {
  for (const [status, expected] of [['待验收', 502], [null, 200]]) {
    const handler = createDashboardService({ fetcher: async url => String(url).includes('/auth/')
      ? reply({ code: 0, tenant_access_token: 'private-token' })
      : reply({ code: 0, data: { items: [{ record_id: 'id', fields: { 任务名称: '示例任务', 完成情况: status, 私有资料: 'private-never-return' } }], has_more: false } }) })
    const response = await handler(context())
    assert.equal(response.status, expected)
    const body = await response.json()
    if (status) {
      assert.equal(body.reason, 'INVALID_TASK_STATUS')
      assert.deepEqual(body.statusIssues, [{ id: 'id', title: '示例任务', status }])
    } else assert.equal(body.tasks[0].statusMissing, true)
    assert(!JSON.stringify(body).includes('private-never-return'))
    assert(!JSON.stringify(body).includes('private-token'))
  }
})

test('现有任务表的部门多选分别筛选，不拼接标签或重复计任务', () => {
  const tasks = normalizeDashboardRecords([{ record_id: 'task', fields: {
    任务详情: '多部门任务', 负责人: [{ id: 'person', name: '成员' }],
    '负责人.部门': ['哨兵组', '机械组', '组长', '机械组'], 完成情况: '未完成', 最晚截止日期: instant
  } }], { title: '任务详情', assignees: '负责人', group: '负责人.部门' })
  assert.deepEqual(tasks[0].groups, ['哨兵组', '机械组', '组长'])
  assert.equal(tasks[0].group, '哨兵组、机械组、组长')
  assert.equal(tasks[0].completedAt, null)
  assert.equal(selectDashboardTasks(tasks, { status: 'all', group: '机械组' }).length, 1)
  assert.equal(selectDashboardTasks(tasks, { status: 'all', group: '哨兵组' }).length, 1)
  assert.equal(selectDashboardTasks(tasks, { status: 'all', group: '算法组' }).length, 0)
  assert.equal(dashboardRanks(selectDashboardTasks(tasks, { status: 'all', group: '机械组' }), 'todo')[0].count, 1)
})

test('截止边界实时进入逾期，已完成任务不逾期，无截止任务排最后', () => {
  const tasks = dashboardFixtures(instant).data.tasks
  const task = tasks[0]
  assert.equal(dashboardTaskState(task, task.deadline - 1), 'todo')
  assert.equal(dashboardTaskState(task, task.deadline), 'overdue')
  assert.equal(dashboardTaskState({ ...task, status: 'done' }, task.deadline + 1), 'done')
  const pending = selectDashboardTasks(tasks, { now: instant })
  assert.equal(pending.length, 7)
  assert.equal(pending.at(-1).deadline, null)
  assert.equal(selectDashboardTasks(tasks, { status: 'overdue', now: instant }).length, 2)
  assert.equal(selectDashboardTasks(tasks, { status: 'done', now: instant }).length, 3)
  assert.equal(selectDashboardTasks(tasks, { group: '运营组', status: 'all', search: '归档', now: instant }).length, 0)
  assert.equal(selectDashboardTasks(tasks, { status: 'all', search: '示例成员甲', now: instant }).length, 3)
})

test('任务榜按执行人统计，多人任务各记一次，同名不同标识不合并', () => {
  const rows = dashboardRanks([
    { status: 'todo', assignees: [{ key: '1', name: '同名' }, { key: '2', name: '同名' }] },
    { status: 'done', assignees: [{ key: '1', name: '同名' }] },
    { status: 'todo', assignees: [{ key: '1', name: '同名' }] }
  ], 'todo')
  assert.deepEqual(rows.map(row => [row.key, row.count]), [['1', 2], ['2', 1]])
})

test('未配置、未登录及写入请求均不访问上游，响应不缓存', async () => {
  const calls = [], handler = createDashboardService({ fetcher: upstream(calls) })
  const closed = await handler(context({ env: {} }))
  assert.equal(closed.status, 503)
  assert.equal((await closed.json()).code, 'NOT_CONFIGURED')
  const locked = await handler(context({ authenticated: false }))
  assert.equal(locked.status, 401)
  assert.equal(locked.headers.get('Cache-Control'), 'private, no-store')
  const wrong = await handler(context({ authenticated: false, request: new Request('https://example.test/api/dashboard', { headers: { Authorization: 'Bearer old-code' } }) }))
  assert.equal(wrong.status, 401)
  const write = await handler(context({ request: new Request('https://example.test/api/dashboard', { method: 'POST' }) }))
  assert.equal(write.status, 405)
  assert.equal(calls.length, 0)
})

test('分页读取完整任务，复用令牌和缓存，缓存命中仍需有效登录', async () => {
  const calls = []
  const handler = createDashboardService({ now: () => instant, fetcher: async (url, options = {}) => {
    calls.push({ url: String(url), ...options })
    if (String(url).includes('/auth/')) return reply({ code: 0, tenant_access_token: 'tenant-test-only', expire: 7200 })
    const second = new URL(url).searchParams.get('page_token') === 'next'
    return reply({ code: 0, data: { items: second ? records.slice(6) : records.slice(0, 6), has_more: !second, page_token: second ? '' : 'next' } })
  } })
  const result = await handler(context())
  const body = await result.json()
  assert.equal(body.tasks.length, 12)
  assert(!JSON.stringify(body).includes('tenant-test-only'))
  await handler(context())
  assert.equal(calls.length, 3)
  assert(calls.every(call => call.method === undefined || call.url.includes('/auth/')))
  const unauthorized = await handler(context({ authenticated: false }))
  assert.equal(unauthorized.status, 401)
  assert.equal(calls.length, 3)
})

test('并发请求合并上游读取，凭证改变后的请求不会复用旧数据', async () => {
  const calls = [], handler = createDashboardService({ fetcher: upstream(calls), now: () => instant })
  await Promise.all([handler(context()), handler(context()), handler(context())])
  assert.equal(calls.length, 2)
  await handler(context({ env: { ...env, FEISHU_APP_SECRET: 'rotated-secret-only' } }))
  assert.equal(calls.length, 4)
})

test('上游失败保留15分钟内的上次结果，超过期限报错而不是返回空任务', async () => {
  let time = instant, fail = false
  const fetcher = upstream()
  const handler = createDashboardService({ now: () => time, fetcher: (...args) => {
    if (fail) throw new Error('private upstream detail must not leak')
    return fetcher(...args)
  } })
  await handler(context())
  fail = true; time += 31_000
  const stale = await (await handler(context())).json()
  assert.equal(stale.stale, true)
  assert.equal(stale.tasks.length, 12)
  time += 15 * 60_000
  const error = await handler(context())
  assert.equal(error.status, 502)
  assert.equal((await error.json()).code, 'DATA_UNAVAILABLE')
})

test('失效飞书令牌自动刷新一次，读取失败不会泄露上游返回', async () => {
  let auth = 0, read = 0
  const handler = createDashboardService({ fetcher: async url => {
    if (String(url).includes('/auth/')) return reply({ code: 0, tenant_access_token: `token-${++auth}`, expire: 7200 })
    read++
    return read === 1 ? reply({ code: 99991663, msg: 'expired' }) : reply({ code: 0, data: { items: [], has_more: false } })
  } })
  assert.equal((await handler(context())).status, 200)
  assert.equal(auth, 2)
  assert.equal(read, 2)
})

test('分页异常、超过2000条与字段错误不返回残缺成功结果', async () => {
  for (const data of [
    { items: records, has_more: true, page_token: 'same' },
    { items: records, has_more: true },
    { items: [{ record_id: 'id', fields: { 错误标题: 'wrong' } }], has_more: false }
  ]) {
    const handler = createDashboardService({ fetcher: async url => String(url).includes('/auth/')
      ? reply({ code: 0, tenant_access_token: 'token' }) : reply({ code: 0, data }) })
    assert.equal((await handler(context())).status, 502)
  }
  let pages = 0
  const handler = createDashboardService({ fetcher: async url => String(url).includes('/auth/')
    ? reply({ code: 0, tenant_access_token: 'token' })
    : reply({ code: 0, data: { items: Array.from({ length: 500 }, () => records[0]), has_more: true, page_token: `next-${++pages}` } }) })
  const result = await handler(context())
  assert.equal(result.status, 502)
  assert.equal((await result.json()).reason, 'TASK_LIMIT_EXCEEDED')
  assert.equal(pages, 4)
})

test('旧公开开关与共享口令不能替代网站会话，已登录无需口令', async () => {
  const calls = [], handler = createDashboardService({ fetcher: upstream(calls) })
  const request = new Request('https://example.test/api/dashboard?authenticated=true', { headers: { Authorization: 'Bearer old-code' } })
  const legacy = { ...env, DASHBOARD_ACCESS_CODE: 'old-code', DASHBOARD_PUBLIC: 'true' }
  for (const authenticated of [undefined, false, 'true', 1]) {
    const result = await handler({ request, env: legacy, authenticated })
    assert.equal(result.status, 401)
    assert.equal((await result.json()).code, 'LOGIN_REQUIRED')
  }
  assert.equal(calls.length, 0)
  assert.equal((await handler(context())).status, 200)
})

test('面板容量随真实可用宽高增长，窄屏至少保留一列一行', () => {
  assert.deepEqual(dashboardGridLayout(330, 210), { columns: 1, rows: 1, size: 1 })
  assert.deepEqual(dashboardGridLayout(1060, 680), { columns: 2, rows: 2, size: 4 })
  assert.deepEqual(dashboardGridLayout(2470, 1370), { columns: 6, rows: 5, size: 30 })
  assert.equal(dashboardGridLayout(1060, 910).size, 6)
  assert.equal(dashboardGridLayout(1060, 910, 10, 20).size, 4)
  assert.equal(dashboardGridLayout(0, 0).size, 1)
})

test('紧凑卡片按实际行高增加容量，不因屏幕较高拉伸卡片', () => {
  assert.deepEqual(dashboardGridLayout(1060, 680, 10, 16, 224), { columns: 2, rows: 2, size: 4 })
  assert.deepEqual(dashboardGridLayout(1060, 700, 10, 16, 224), { columns: 2, rows: 3, size: 6 })
  assert.equal(dashboardGridLayout(1060, 700, 10, 16).size, 4)
  assert.equal(dashboardGridLayout(1060, 700, 10, 16, NaN).size, 4)
})

test('成员入口直达已有档案，缺少档案时不生成链接', () => {
  assert.equal(dashboardMemberPath('成员甲', ['成员甲']), '/team/' + encodeURIComponent('成员甲'))
  assert.equal(dashboardMemberPath('成员乙 & /'), '')
  const task = normalizeDashboardRecords([{ record_id: 'publisher-test', fields: {
    任务名称: '任务', 完成情况: '未完成', 发布人: [{ id: 'p', name: '成员甲', avatar_url: 'https://example.test/avatar.png', email: 'private@example.test' }]
  } }])[0]
  assert.deepEqual(task.publishers, [{ key: 'p', name: '成员甲', avatar: 'https://example.test/avatar.png' }])
  assert(!JSON.stringify(task).includes('private@example.test'))
})


test('同一窗口下每页容量固定，完整页均为相同行数，尾页不丢项', () => {
  const pages = dashboardTaskPages(30, 3, 2)
  assert.equal(pages.length, 5)
  assert(pages.every(page => page.end - page.start === 6))
  assert.deepEqual(pages.flatMap(page => Array.from({ length: page.end - page.start }, (_, i) => page.start + i)), Array.from({ length: 30 }, (_, i) => i))
  assert.deepEqual(dashboardTaskPages(29, 3, 2).at(-1), { start: 24, end: 29 })
  assert.deepEqual(dashboardTaskPages(0, 3, 2), [])
  assert.deepEqual(dashboardTaskPages(1, 3, 2), [{ start: 0, end: 1 }])
  assert.equal(dashboardTaskPages(30, 3, 3).length, 4)
})

test('任务榜返回全部人员供滚动展示，不只保留前八名', () => {
  const tasks = Array.from({ length: 15 }, (_, i) => ({ status: 'todo', assignees: [{ key: String(i), name: `成员${i}` }] }))
  assert.equal(dashboardRanks(tasks, 'todo').length, 15)
})

test('分值读取数字或数字单选，区分零分、空白和异常，不换算旧优先级', () => {
  const parse = (value, overrides = {}) => normalizeDashboardRecords([{ record_id: 'score', fields: {
    任务名称: '计分任务', 完成情况: '已完成', 分值: value, 优先级: '高', 自定义分值: '2.5'
  } }], overrides)[0]
  for (const [value, expected] of [[5, 5], [' 4 ', 4], [0, 0], ['0', 0], ['2.5', 2.5]]) {
    const task = parse(value)
    assert.equal(task.score, expected)
    assert.equal(task.scoreInvalid, false)
    assert.equal(dashboardScoreLabel(task), `${expected}分`)
  }
  for (const value of [undefined, null, '', '  ']) {
    assert.equal(parse(value).score, null)
    assert.equal(parse(value).scoreInvalid, false)
    assert.equal(dashboardScoreLabel(parse(value)), '未设分')
  }
  for (const value of ['待核定', '5分', '高', '-1', -1, Infinity, NaN, true, {}, ['5'], '2.5.1', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(parse(value).score, null)
    assert.equal(parse(value).scoreInvalid, true)
    assert.equal(dashboardScoreLabel(parse(value)), '分值异常')
  }
  assert.equal(parse(5, { score: '自定义分值' }).score, 2.5)
  assert.equal(dashboardScoreLabel({}), '未设分')
})

test('总分仅来自已完成任务，缺分和异常提示，零分合法，无人任务不分配积分', () => {
  const person = { key: 'p', name: '执行人', avatar: '' }
  const task = (id, overrides = {}) => ({ id, status: 'done', score: 5, completedAt: null, assignees: [person], ...overrides })
  const result = dashboardScoreboard([
    task('five'), task('three', { score: 3 }), task('todo', { status: 'todo', deadline: instant - 1 }),
    task('blank', { score: null }), task('invalid', { score: null, scoreInvalid: true }), task('zero', { score: 0 }),
    task('unassigned', { assignees: [], publisher: '发布人' })
  ])
  assert.deepEqual(result.rows.map(row => [row.key, row.score, row.doneCount, row.rank]), [['p', 8, 5, 1]])
  assert.equal(result.missingScoreCount, 1)
  assert.equal(result.invalidScoreCount, 1)
  assert.equal(result.unassignedCount, 1)
  assert.deepEqual(dashboardScoreboard([]), { rows: [], missingScoreCount: 0, invalidScoreCount: 0, unassignedCount: 0 })
})

test('多人各得全分，人员和任务不重复累计，同名不同标识不合并，同分并列', () => {
  const a = { key: 'a', name: '同名', avatar: '' }, b = { ...a, key: 'b' }
  const row = { id: 'shared', status: 'done', score: 5, assignees: [a, a, b] }
  const result = dashboardScoreboard([row, row, { id: 'pending', status: 'todo', score: 9, assignees: [{ key: 'c', name: '待办成员', avatar: '' }] }])
  assert.deepEqual(result.rows.map(person => [person.key, person.score, person.doneCount, person.rank]), [['a', 5, 1, 1], ['b', 5, 1, 1], ['c', 0, 0, 3]])
  const fractions = dashboardScoreboard([
    { id: 'one', status: 'done', score: .1, assignees: [a] }, { id: 'two', status: 'done', score: .2, assignees: [a] },
    { id: 'three', status: 'done', score: .3, assignees: [b] }
  ])
  assert.deepEqual(fractions.rows.map(person => [person.score, person.rank]), [[.3, 1], [.3, 1]])
})

test('完成、撤回、改分、补分、转交和删除在重算后生效，不依赖完成日期或累加次数', () => {
  const person = { key: 'p', name: '原负责人', avatar: '' }
  const task = { id: 'changing', status: 'todo', score: 5, assignees: [person], completedAt: null }
  const score = () => dashboardScoreboard([task]).rows[0].score
  assert.equal(score(), 0)
  task.status = 'done'
  assert.equal(score(), 5)
  assert.equal(score(), 5)
  task.status = 'todo'
  assert.equal(score(), 0)
  task.status = 'done'; task.score = 3
  assert.equal(score(), 3)
  task.score = null
  assert.equal(score(), 0)
  task.score = 4; task.assignees = [{ ...person, key: 'next', name: '新负责人' }]
  assert.deepEqual(dashboardScoreboard([task]).rows.map(row => [row.key, row.score]), [['next', 4]])
  assert.deepEqual(dashboardScoreboard([]).rows, [])
})

test('分值排序截止时间优先、同截止高分优先、零分先于缺分，完整人员榜跟随组别', () => {
  const tasks = normalizeDashboardRecords(Array.from({ length: 16 }, (_, i) => ({ record_id: String(i), fields: {
    任务名称: `任务${i}`, 完成情况: i % 2 ? '已完成' : '未完成', 分值: i === 0 ? undefined : i === 1 ? 0 : i,
    执行人: [{ id: String(i), name: `成员${i}` }], 所属组别: i < 8 ? '电控组' : '机械组', 截止时间: i === 15 ? instant - 1000 : instant
  } })))
  const sorted = selectDashboardTasks(tasks, { status: 'all' })
  assert.deepEqual(sorted.slice(0, 3).map(task => task.id), ['15', '14', '13'])
  assert.deepEqual(sorted.slice(-2).map(task => task.id), ['1', '0'])
  assert.equal(dashboardScoreboard(tasks).rows.length, 16)
  const scoped = dashboardScoreboard(selectDashboardTasks(tasks, { status: 'all', group: '电控组' }))
  assert.equal(scoped.rows.length, 8)
  assert.equal(scoped.rows.reduce((total, row) => total + row.score, 0), 15)
})

test('现有字段映射无需新增配置即可通过只读服务返回分值与异常标记', async () => {
  const handler = createDashboardService({ fetcher: async url => String(url).includes('/auth/')
    ? reply({ code: 0, tenant_access_token: 'test-token', expire: 7200 })
    : reply({ code: 0, data: { items: [{ record_id: 'real-shape', fields: {
      任务详情: '单选分值', 负责人: [{ id: 'p', name: '成员' }], '负责人.部门': ['电控组'], 完成情况: '已完成', 分值: '5'
    } }], has_more: false } }) })
  const result = await handler(context({ env: { ...env, FEISHU_FIELD_MAP: JSON.stringify({ title: '任务详情', assignees: '负责人', group: '负责人.部门', status: '完成情况', deadline: '最晚截止日期' }) } }))
  assert.equal(result.status, 200)
  const body = await result.json()
  assert.equal(body.tasks[0].score, 5)
  assert.equal(body.tasks[0].scoreInvalid, false)
  assert.equal(body.tasks[0].completedAt, null)
  assert.equal(dashboardScoreboard(body.tasks).rows[0].score, 5)
})


test('默认直接读取 YSU 同结构表格，保留部门多选、负责人和分值，不泄露额外列', () => {
  const [task] = normalizeDashboardRecords([{ record_id: 'ysu-compatible', fields: {
    '周段': '07周', '任务详情': [{ text: '底盘联调' }], '负责人.部门': ['机械组', '嵌入式组'],
    '负责人': [{ id: 'person-a', name: '示例队员', email: 'private@example.test' }],
    '发布人': [{ id: 'publisher-a', name: '示例组长' }], '最晚截止日期': instant,
    '任务发布时间': instant - 1000, '完成情况': '已完成', '分值': '5',
    '验收附件': [{ token: 'private-file-token' }]
  } }])
  assert.equal(task.title, '底盘联调')
  assert.deepEqual(task.groups, ['机械组', '嵌入式组'])
  assert.equal(task.assignees[0].name, '示例队员')
  assert.equal(task.deadline, instant)
  assert.equal(task.completedAt, null)
  assert.equal(task.status, 'done')
  assert.equal(dashboardScoreboard([task]).rows[0].score, 5)
  assert(!JSON.stringify(task).includes('private-file-token'))
  assert(!JSON.stringify(task).includes('private@example.test'))
})
