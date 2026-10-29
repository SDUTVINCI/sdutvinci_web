import { test } from 'vitest'
import assert from 'node:assert/strict'
import { dashboardUrgency, dashboardTaskCountdown, dashboardNextDeadlines, dashboardPreferences, readDashboardPreferences, dashboardCompletionStats } from '../utils/dashboard-experience.mjs'

const parse = value => Date.parse(value + '+08:00')
const task = (id, overrides = {}) => ({ id, status: 'todo', deadline: null, completedAt: null, score: null, ...overrides })

test('临近截止按北京时间区分今日、跨日24小时及三天，边界不误报', () => {
  const now = parse('2026-10-22T23:00:00')
  const urgency = (value, extra = {}) => dashboardUrgency(task('x', { deadline: parse(value), ...extra }), now)
  assert.equal(urgency('2026-10-22T23:00:00').level, 'overdue')
  assert.equal(urgency('2026-10-22T23:59:59').level, 'today')
  assert.equal(urgency('2026-10-23T00:00:00').level, 'soon')
  assert.equal(urgency('2026-10-23T23:00:00').level, 'soon')
  assert.equal(urgency('2026-10-25T23:00:00').level, 'upcoming')
  assert.equal(urgency('2026-10-25T23:00:01'), null)
  assert.equal(urgency('2026-10-22T23:59:59', { status: 'done' }), null)
  assert.equal(dashboardUrgency(task('x'), now), null)
})

test('相同最近截止任务完整返回，排序稳定，排除已完成、已逾期及无日期', () => {
  const now = parse('2026-10-22T12:00:00'), deadline = now + 1000
  const rows = [task('z', { deadline }), task('a', { deadline }), task('score', { deadline, score: 5 }),
    task('done', { deadline, status: 'done' }), task('overdue', { deadline: now }), task('empty'), task('later', { deadline: deadline + 1 })]
  assert.deepEqual(dashboardNextDeadlines(rows, now).map(row => row.id), ['score', 'a', 'z'])
  assert.deepEqual(dashboardNextDeadlines(rows, deadline).map(row => row.id), ['later'])
  assert.deepEqual(dashboardNextDeadlines([], now), [])
})

test('显示偏好严格白名单保存，不接受口令、任务数据及无效结构', () => {
  const defaults = { version: 1, group: 'all', status: 'todo', screen: false, autoRotate: true }
  assert.deepEqual(readDashboardPreferences('broken'), defaults)
  assert.deepEqual(readDashboardPreferences('[]'), defaults)
  assert.deepEqual(readDashboardPreferences('{"version":99,"screen":true}'), defaults)
  assert.deepEqual(dashboardPreferences({ version: 1, group: '机械组', status: 'done', screen: true, autoRotate: false, authorization: 'never-save', tasks: ['private'] }),
    { version: 1, group: '机械组', status: 'done', screen: true, autoRotate: false })
  assert.deepEqual(dashboardPreferences({ version: 1, group: {}, status: 'unknown', screen: 'true', autoRotate: 0 }), defaults)
  assert.equal(dashboardPreferences({ version: 1, group: 'x'.repeat(101) }).group, 'all')
})

test('完成统计以北京时间周一及最近七个自然日为界，不计未来或缺失完成时间', () => {
  const now = parse('2026-10-26T00:30:00') // 周一
  const rows = [
    task('monday', { status: 'done', completedAt: parse('2026-10-26T00:00:00'), deadline: parse('2026-10-26T00:00:00') }),
    task('sunday', { status: 'done', completedAt: parse('2026-10-25T23:59:59'), deadline: parse('2026-10-25T22:00:00') }),
    task('late', { status: 'done', completedAt: parse('2026-10-26T00:20:00'), deadline: parse('2026-10-26T00:10:00') }),
    task('noDeadline', { status: 'done', completedAt: parse('2026-10-26T00:10:00') }),
    task('old', { status: 'done', completedAt: parse('2026-10-19T23:59:59') }),
    task('missing', { status: 'done' }),
    task('future', { status: 'done', completedAt: now + 1 }),
    task('notDone', { completedAt: now - 1 })
  ]
  const result = dashboardCompletionStats(rows, now)
  assert.equal(result.weekCount, 3)
  assert.equal(result.recentCount, 4)
  assert.equal(result.days[0].date, '2026-10-20')
  assert.equal(result.days[6].count, 3)
  assert.equal(result.missingTimeCount, 2)
  assert.equal(result.onTimeRate, 50)
  assert.equal(result.eligibleCount, 2)
  assert.equal(result.weekWithoutDeadline, 1)
})

test('没有完成时间时不编造零值趋势或按时率，有效空任务与跨年日期正常', () => {
  const now = parse('2027-01-01T10:00:00')
  const missing = dashboardCompletionStats([task('missing', { status: 'done' })], now)
  assert.equal(missing.available, false)
  assert.equal(missing.onTimeRate, null)
  assert.equal(dashboardCompletionStats([], now).available, true)
  const result = dashboardCompletionStats([task('year', { status: 'done', completedAt: parse('2026-12-31T23:59:59') })], now)
  assert.equal(result.weekCount, 1)
  assert.equal(result.days.at(-2).date, '2026-12-31')
  assert.equal(result.onTimeRate, null)
})

test('任务倒计时保留天时分秒，到期边界与跨日一致，完成和缺少日期明确区分', () => {
  const now = parse('2026-10-23T12:00:00')
  assert.equal(dashboardTaskCountdown(task('x', { deadline: now + 3 * 86400000 + 6 * 3600000 + 24 * 60000 + 18000 }), now), '剩余 3天 06:24:18')
  assert.equal(dashboardTaskCountdown(task('x', { deadline: now + 1 }), now), '剩余 0天 00:00:01')
  assert.equal(dashboardTaskCountdown(task('x', { deadline: now }), now), '已逾期 0天 00:00:00')
  assert.equal(dashboardTaskCountdown(task('x', { deadline: now - 2 * 86400000 - 3 * 3600000 - 12500 }), now), '已逾期 2天 03:00:12')
  assert.equal(dashboardTaskCountdown(task('x', { deadline: now + 1000 }), now + 1000), '已逾期 0天 00:00:00')
  assert.equal(dashboardTaskCountdown(task('x', { deadline: now, status: 'done' }), now), '')
  assert.equal(dashboardTaskCountdown(task('x'), now), '未设置截止')
  assert.equal(dashboardTaskCountdown(task('x', { deadline: NaN }), now), '未设置截止')
  assert.equal(dashboardTaskCountdown(task('x', { deadline: now }), 0), '正在校时…')
})
