import { compareDashboardScores } from './dashboard-data.mjs'

const DAY = 86_400_000
const BEIJING_OFFSET = 8 * 3600_000
const dayStart = now => Math.floor((now + BEIJING_OFFSET) / DAY) * DAY - BEIJING_OFFSET

export function dashboardUrgency(task, now) {
  if (task.status === 'done' || task.deadline === null || !Number.isFinite(task.deadline) || now <= 0) return null
  const left = task.deadline - now
  if (left <= 0) return { level: 'overdue', label: '已逾期' }
  if (dayStart(task.deadline) === dayStart(now)) return { level: 'today', label: '今日到期' }
  if (left <= DAY) return { level: 'soon', label: '24小时内' }
  if (left <= 3 * DAY) return { level: 'upcoming', label: '3天内' }
  return null
}

// 共用页面时钟：未来向上取整避免到期前显示零；逾期按已过整秒计时。
export function dashboardTaskCountdown(task, now) {
  if (task.status === 'done') return ''
  if (!Number.isFinite(task.deadline) || task.deadline <= 0) return '未设置截止'
  if (!Number.isFinite(now) || now <= 0) return '正在校时…'
  const overdue = now >= task.deadline
  const seconds = overdue ? Math.floor((now - task.deadline) / 1000) : Math.ceil((task.deadline - now) / 1000)
  const pad = value => String(value).padStart(2, '0')
  return `${overdue ? '已逾期' : '剩余'} ${Math.floor(seconds / 86400)}天 ${pad(Math.floor(seconds / 3600) % 24)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`
}

export function dashboardNextDeadlines(tasks, now) {
  const pending = tasks.filter(task => task.status !== 'done' && Number.isFinite(task.deadline) && task.deadline > now)
  if (!pending.length) return []
  const earliest = Math.min(...pending.map(task => task.deadline))
  return pending.filter(task => task.deadline === earliest).sort((a, b) =>
    compareDashboardScores(a, b) || a.id.localeCompare(b.id))
}

export const DASHBOARD_PREFERENCES_KEY = 'vinci-dashboard-display-v1'
export function dashboardPreferences(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) && value.version === 1 ? value : {}
  return {
    version: 1,
    group: typeof source.group === 'string' && source.group.trim() && source.group.length <= 100 ? source.group.trim() : 'all',
    status: ['todo', 'overdue', 'done'].includes(source.status) ? source.status : 'todo',
    screen: typeof source.screen === 'boolean' ? source.screen : false,
    autoRotate: typeof source.autoRotate === 'boolean' ? source.autoRotate : true
  }
}

export function readDashboardPreferences(raw) {
  try { return dashboardPreferences(JSON.parse(raw || 'null')) } catch { return dashboardPreferences(null) }
}

// 北京时间周一零点为本周起点；缺少/未来的完成时间不纳入统计，不用任务发布时间代替。
export function dashboardCompletionStats(tasks, now) {
  const today = dayStart(now)
  const weekday = new Date(today + BEIJING_OFFSET).getUTCDay()
  const weekStart = today - ((weekday + 6) % 7) * DAY
  const done = tasks.filter(task => task.status === 'done')
  const dated = done.filter(task => Number.isFinite(task.completedAt) && task.completedAt > 0 && task.completedAt <= now)
  const week = dated.filter(task => task.completedAt >= weekStart)
  const eligible = week.filter(task => Number.isFinite(task.deadline))
  const onTime = eligible.filter(task => task.completedAt <= task.deadline).length
  const days = Array.from({ length: 7 }, (_, index) => {
    const start = today - (6 - index) * DAY
    const date = new Date(start + BEIJING_OFFSET).toISOString().slice(0, 10)
    return { date, count: dated.filter(task => task.completedAt >= start && task.completedAt < start + DAY).length }
  })
  return {
    available: done.length === 0 || dated.length > 0,
    doneCount: done.length, datedCount: dated.length, missingTimeCount: done.length - dated.length,
    weekCount: week.length, recentCount: days.reduce((sum, day) => sum + day.count, 0),
    onTimeCount: onTime, eligibleCount: eligible.length,
    onTimeRate: eligible.length ? Math.round(onTime / eligible.length * 100) : null,
    weekWithoutDeadline: week.length - eligible.length, days
  }
}
