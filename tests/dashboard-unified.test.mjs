import { describe, expect, it } from 'vitest'
import { createDashboardService } from '../utils/dashboard-service.mjs'
import { dashboardSourceConfig } from '../utils/dashboard-source-config.mjs'
import { dashboardMemberIndex, applyDashboardMembers, dashboardCohortRanking } from '../utils/dashboard-members.mjs'
import { dashboardTaskMetrics, dashboardTaskState, dashboardScoreboard, selectDashboardTasks } from '../utils/dashboard-data.mjs'
import { dashboardCompletionStats, dashboardUrgency, dashboardTaskCountdown, dashboardPreferences } from '../utils/dashboard-experience.mjs'

const now = Date.parse('2026-11-07T12:00:00+08:00')
const senior = { id: 'account-a', name: '同名成员' }, junior = { id: 'account-b', name: '同名成员' }
const record = (id, fields = {}) => ({ record_id: id, fields: { 任务名称: '任务', 完成情况: '未开始', ...fields } })
const member = (person, cohort, groups = ['机械组']) => ({ fields: { 飞书账号: [person], 啥登: cohort, 组别: groups } })
const env = { DASHBOARD_ENABLED: 'true', FEISHU_APP_ID: 'test', FEISHU_APP_SECRET: 'private-secret',
  FEISHU_BITABLE_APP_TOKEN: 'private-base', FEISHU_BITABLE_TABLE_ID: 'tblRequired',
  FEISHU_OPTIONAL_TABLE_ID: 'tblOptional', FEISHU_MEMBERS_TABLE_ID: 'tblMembers',
  FEISHU_DASHBOARD_URL: 'https://example.feishu.cn/wiki/PublicNode', FEISHU_BITABLE_VIEW_ID: 'vewRequired' }

function fixture(overrides = {}) {
  const state = { time: now, fail: [], requests: [], tables: {
    tblRequired: [record('same', { 负责人: [senior, junior], 完成情况: '已完成', 分值: 5, 审核通过时间: now - 1000, 审核人: [senior] })],
    tblOptional: [record('same', { 负责人: [senior], 完成情况: '已完成', 分值: 3 }), record('unclaimed', { 最晚截止日期: now - 1000 })],
    tblMembers: [member(senior, '老登'), member(junior, '小登', ['嵌入式组'])]
  }, ...overrides }
  const service = createDashboardService({ now: () => state.time, fetcher: async (url, options = {}) => {
    state.requests.push([String(url), options.method || 'GET'])
    if (String(url).includes('/auth/')) return Response.json({ code: 0, tenant_access_token: 'private-token' })
    const table = /\/tables\/([^/]+)\/records/.exec(String(url))?.[1]
    if (!table || !Object.hasOwn(state.tables, table)) throw new Error('Unexpected upstream route')
    if (state.fail.includes(table)) throw new Error('private-error')
    return Response.json({ code: 0, data: { items: state.tables[table], has_more: false } })
  } })
  const read = async (options = {}) => service({ env, authenticated: true, request: new Request('https://example.test/api/dashboard'), ...options })
  return { state, read, body: async () => (await read()).json() }
}

describe('统一任务列表的真实读取链路', () => {
  it('合并两表并隔离同名记录ID；多人任务逐账号分榜，安全链接不含Base token', async () => {
    const { body, state } = fixture()
    const data = await body()
    expect(data.tasks.map(task => task.id)).toEqual(['required:same', 'optional:same', 'optional:unclaimed'])
    expect(data.sources.map(source => [source.kind, source.taskCount])).toEqual([['required', 1], ['optional', 2]])
    expect(data.tasks[0].reviewers[0].key).toBe(senior.id)
    const score = dashboardScoreboard(data.tasks)
    expect(score.rows.map(row => [row.key, row.score])).toEqual([['account-a', 8], ['account-b', 5]])
    expect(dashboardCohortRanking(score.rows, data.tasks, 'junior').rows.map(row => row.key)).toEqual(['account-b'])
    expect(data.tasks[0].cohorts).toEqual(['老登', '小登'])
    expect(data.tasks[0].feishuUrl).toBe('https://example.feishu.cn/wiki/PublicNode?table=tblRequired&record=same')
    expect(JSON.stringify(data)).not.toMatch(/private-secret|private-base|private-token|private-error/)
    expect(state.requests.filter(([url]) => url.includes('/records')).every(([, method]) => method === 'GET')).toBe(true)
    for (const [url] of state.requests.filter(([url]) => url.includes('/records'))) {
      expect(new URL(url).searchParams.get('view_id')).toBe(url.includes('/tblRequired/') ? 'vewRequired' : null)
    }
  })

  it('共享并发读取和缓存；身份、部门和分数变化后重算，不改旧缓存对象', async () => {
    const { state, body } = fixture()
    const [first] = await Promise.all([body(), body(), body()])
    expect(state.requests).toHaveLength(4)
    state.time += 31_000
    state.tables.tblMembers = [member(senior, '小登', ['运营组']), member(junior, '小登')]
    state.tables.tblOptional[0].fields.分值 = 7
    const updated = await body()
    expect(updated.tasks[1].groups).toEqual(['运营组'])
    expect(dashboardCohortRanking(dashboardScoreboard(updated.tasks).rows, updated.tasks, 'senior').rows).toEqual([])
    expect(dashboardScoreboard(updated.tasks).rows[0].score).toBe(12)
    expect(first.tasks[1].groups).toEqual(['机械组'])
  })

  it('单表失败明确标记部分数据，成功表仍可用；恢复后自动补全', async () => {
    const { state, body } = fixture({ fail: ['tblOptional'] })
    const data = await body()
    expect(data.partial).toBe(true)
    expect(data.tasks).toHaveLength(1)
    expect(data.sources[1]).toMatchObject({ kind: 'optional', unavailable: true })
    expect(data.sources[1].taskCount).toBeUndefined()
    state.fail = []
    expect((await body()).tasks).toHaveLength(3)
  })

  it('两表独立回退15分钟内缓存，过期表移出统计并标记不可用', async () => {
    const { state, body } = fixture()
    await body()
    state.time += 31_000; state.fail = ['tblOptional']
    const stale = await body()
    expect(stale.sources[0].stale).toBe(false)
    expect(stale.sources[1]).toMatchObject({ stale: true, updatedAt: now })
    expect(stale.stale).toBe(true)
    state.time += 15 * 60_000
    const expired = await body()
    expect(expired.partial).toBe(true)
    expect(expired.tasks.every(task => task.kind === 'required')).toBe(true)
    const result = await fixture({ fail: ['tblRequired', 'tblOptional'] }).read()
    expect(result.status).toBe(502)
  })

  it('成员表失败时不使用旧任务查找标签冒充分榜，任务和积分总榜仍可用', async () => {
    const { state, body } = fixture()
    await body()
    state.tables.tblRequired[0].fields.啥登 = '老登'
    state.fail = ['tblMembers']; state.time += 31_000
    const data = await body()
    expect(data.membersUnavailable).toBe(true)
    expect(data.tasks[0].cohorts).toEqual([])
    expect(dashboardCohortRanking(dashboardScoreboard(data.tasks).rows, data.tasks, 'senior').rows).toEqual([])
    expect(dashboardScoreboard(data.tasks).rows).toHaveLength(2)
  })

  it('成员表完整分页；空白任务的默认状态不触发映射错误', async () => {
    const { state, body } = fixture()
    state.tables.tblOptional = [{ record_id: 'blank', fields: { 完成情况: '未开始', 分值: '2', 周次: '第1周' } }]
    expect((await body()).sources[1]).toMatchObject({ unavailable: false, taskCount: 0 })
    let memberPages = 0
    const service = createDashboardService({ fetcher: async url => {
      if (String(url).includes('/auth/')) return Response.json({ code: 0, tenant_access_token: 'test' })
      if (String(url).includes('/tblMembers/')) {
        memberPages++
        const second = new URL(url).searchParams.has('page_token')
        return Response.json({ code: 0, data: { items: second ? [member(junior, '小登')] : [member(senior, '老登')], has_more: !second, page_token: 'next' } })
      }
      return Response.json({ code: 0, data: { items: [record('same', { 负责人: [senior, junior] })], has_more: false } })
    } })
    const result = await service({ env, authenticated: true, request: new Request('https://example.test') })
    expect((await result.json()).tasks[0].cohorts).toEqual(['老登', '小登'])
    expect(memberPages).toBe(2)
  })
})

it('成员身份冲突、同名不同账号、仅多人任务和账号缺失均按稳定账号处理', () => {
  const index = dashboardMemberIndex([member(senior, '老登'), member(senior, '小登'), member(senior, '老登'), member(junior, '小登')])
  const tasks = applyDashboardMembers([{ id: 'shared', status: 'done', score: 3, groups: [], assignees: [
    { key: senior.id, name: senior.name }, { key: junior.id, name: junior.name }, { key: '同名成员', name: '同名成员' }
  ] }], index)
  const scores = dashboardScoreboard(tasks).rows
  expect(dashboardCohortRanking(scores, tasks, 'senior').rows).toEqual([])
  expect(dashboardCohortRanking(scores, tasks, 'junior').rows.map(row => row.key)).toEqual([junior.id])
  expect(dashboardCohortRanking(scores, tasks, 'all').unmatchedCount).toBe(2)
})

it('类型、身份、认领、周次、部门和关键词可组合，未认领不受伪造完成状态计入统计', async () => {
  const { body } = fixture()
  const { tasks } = await body()
  expect(selectDashboardTasks(tasks, { status: 'all', kind: 'required', cohort: 'junior', group: '嵌入式组' })).toHaveLength(1)
  expect(selectDashboardTasks(tasks, { status: 'all', kind: 'optional', claim: 'unclaimed' }).map(task => task.id)).toEqual(['optional:unclaimed'])
  expect(selectDashboardTasks(tasks, { status: 'all', kind: 'optional', claim: 'unclaimed', cohort: 'junior' })).toEqual([])
  expect(selectDashboardTasks(tasks, { status: 'all', week: '10' })).toEqual([])
  expect(selectDashboardTasks(tasks, { status: 'all', search: '不存在' })).toEqual([])
  const unclaimed = { ...tasks[2], status: 'done', completedAt: now - 1, score: 999 }
  expect(dashboardTaskState(unclaimed, now)).toBe('unclaimed')
  expect(dashboardUrgency(unclaimed, now)).toBeNull()
  expect(dashboardTaskCountdown(unclaimed, now)).toContain('待认领')
  expect(selectDashboardTasks([unclaimed], { status: 'pending' })).toHaveLength(1)
  expect(selectDashboardTasks([unclaimed], { status: 'done' })).toEqual([])
  expect(dashboardCompletionStats([unclaimed], now).doneCount).toBe(0)
  expect(dashboardScoreboard([unclaimed])).toMatchObject({ rows: [], unassignedCount: 0 })
  expect(dashboardTaskMetrics([...tasks.slice(0, 2), unclaimed], now)).toMatchObject({ requiredTotal: 1, requiredDone: 1, requiredRate: 100, unclaimed: 1, done: 2, overdue: 0 })
})

it('新增筛选偏好仍为白名单，跨类型自动清除认领筛选', () => {
  expect(dashboardPreferences({ version: 1, kind: 'optional', cohort: 'junior', claim: 'unclaimed', tasks: ['secret'] }))
    .toMatchObject({ kind: 'optional', cohort: 'junior', claim: 'unclaimed' })
  expect(dashboardPreferences({ version: 1, kind: 'required', claim: 'unclaimed', cohort: 'invalid' }))
    .toMatchObject({ kind: 'required', cohort: 'all', claim: 'all' })
})

it('只对SDUT已接通的主表启用默认关联，禁止重复源，不输出含凭证入口', () => {
  expect(dashboardSourceConfig({ FEISHU_BITABLE_TABLE_ID: 'tblODdgBNZ6tNGRt' }).sources).toHaveLength(2)
  expect(dashboardSourceConfig({ FEISHU_BITABLE_TABLE_ID: 'tblOther' }).sources).toHaveLength(1)
  expect(dashboardSourceConfig({ ...env, FEISHU_DASHBOARD_URL: 'https://user:secret@example.feishu.cn/wiki/Page' }).wiki).toBe('')
  expect(dashboardSourceConfig({ ...env, FEISHU_DASHBOARD_URL: 'https://example.feishu.cn/base/private-token' }).wiki).toBe('')
  expect(() => dashboardSourceConfig({ ...env, FEISHU_OPTIONAL_TABLE_ID: env.FEISHU_BITABLE_TABLE_ID })).toThrow('INVALID_SOURCE_CONFIG')
})
