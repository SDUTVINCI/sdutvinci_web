import { expect, it } from 'vitest'
import { normalizeDashboardRecords, selectDashboardTasks, dashboardTaskState, dashboardScoreboard } from '../utils/dashboard-data.mjs'

const person = { id: 'account', name: '示例成员' }
const record = (fields, id = 'task') => ({ record_id: id, fields: { 任务名称: '学习任务', 负责人: [person], ...fields } })

it('读取新任务列与嵌套查找引用，旧服务器字段映射仍可回退到新列名', () => {
  const time = Date.parse('2026-10-30T10:00:00+08:00')
  const task = normalizeDashboardRecords([record({
    任务要求: [{ text: '1. 第一条\n2. 第二条' }], 验收标准: '能演示', 周次: '第10周', 完成情况: '待验收',
    部门: { type: 3, value: [{ type: 3, value: ['软件算法组', '机械组'] }] },
    啥登: { type: 3, value: [{ text: '老登', type: 'text' }] }, 审核通过时间: time, 发布与审核人: [person]
  })], { title: '任务详情', group: '负责人.部门', completedAt: '完成时间', publisher: '发布人' })[0]
  expect(task).toMatchObject({ title: '学习任务', requirements: '1. 第一条\n2. 第二条', acceptance: '能演示', week: 10,
    groups: ['软件算法组', '机械组'], cohorts: ['老登'], status: 'review', completedAt: time, publisher: '示例成员' })
})

it('周次只接受1—20周，空缺和越界不伪造周次', () => {
  const tasks = normalizeDashboardRecords(['第1周', '第20周', '第0周', '第21周', '', 10].map((周次, i) => record({ 周次 }, String(i))))
  expect(tasks.map(task => task.week)).toEqual([1, 20, null, null, null, 10])
})

it('四阶段兼容旧未完成；逾期独立于阶段，只有已完成计分；周次可单独筛选', () => {
  const now = Date.parse('2026-10-30T00:00:00+08:00')
  const tasks = normalizeDashboardRecords(['未开始', '进行中', '待验收', '已完成', '未完成'].map((value, i) => record({
    完成情况: value, 周次: i === 4 ? '' : `第${i + 1}周`, 分值: 3, 最晚截止日期: now - 1000
  }, String(i))))
  expect(tasks.map(task => task.status)).toEqual(['todo', 'progress', 'review', 'done', 'todo'])
  expect(dashboardTaskState(tasks[2], now)).toBe('overdue')
  expect(selectDashboardTasks(tasks, { status: 'pending' })).toHaveLength(4)
  expect(selectDashboardTasks(tasks, { status: 'review', week: '3' })).toHaveLength(1)
  expect(selectDashboardTasks(tasks, { status: 'all', week: 'missing' })).toHaveLength(1)
  expect(dashboardScoreboard(tasks).rows[0].score).toBe(3)
  expect(selectDashboardTasks(tasks, { status: 'all', week: '2', group: '机械组' })).toHaveLength(0)
})

it('成果仅返回安全链接与附件展示信息，不泄露下载令牌或受保护API地址', () => {
  const task = normalizeDashboardRecords([record({
    Github链接等: 'https://github.com/example/repo\nhttps://example.test/demo javascript:alert(1)',
    成果附件: [
      { name: '练习.zip', file_token: 'private-file-token', tmp_url: 'https://open.feishu.cn/open-apis/drive/v1/medias/download', size: 20 },
      { name: '报告.pdf', link: 'https://example.test/report.pdf' },
      { name: '内部.pdf', link: 'https://open.feishu.cn/open-apis/drive/v1/medias/token/download' },
      { name: '不安全', link: 'javascript:alert(1)' }
    ]
  })])[0]
  expect(task.links).toEqual(['https://github.com/example/repo', 'https://example.test/demo'])
  expect(task.attachments.map(item => item.href)).toEqual(['', 'https://example.test/report.pdf', '', ''])
  expect(JSON.stringify(task)).not.toMatch(/private-file-token|open-apis|javascript:/)
})
