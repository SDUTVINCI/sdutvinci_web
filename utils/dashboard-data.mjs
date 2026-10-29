export const DASHBOARD_FIELD_NAMES = {
  title: ['任务详情', '任务名称'], group: ['负责人.部门', '所属组别', '组别'], assignees: ['负责人', '执行人'], publisher: ['发布人'],
  deadline: ['最晚截止日期', '截止时间'], score: ['分值'], priority: ['优先级'], status: ['完成情况', '完成状态'],
  completedAt: ['完成时间'], note: ['备注']
}

function text(value) {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) return value.map(item => typeof item === 'string' ? item : item?.text || '').join('').trim()
  return ''
}

export function safeDashboardUrl(value) {
  if (typeof value !== 'string') return ''
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''
  } catch { return '' }
}

function people(value) {
  const rows = Array.isArray(value) ? value : value ? [value] : []
  const seen = new Set()
  return rows.flatMap(item => {
    const name = typeof item === 'string' ? item.trim() : text(item?.name)
    const key = typeof item?.id === 'string' ? item.id : name
    if (!name || seen.has(key)) return []
    seen.add(key)
    return [{ key, name, avatar: safeDashboardUrl(item?.avatar_url) }]
  })
}

function timestamp(value) {
  if (value === undefined || value === null || value === '') return null
  const number = typeof value === 'number' || /^\d+$/.test(String(value)) ? Number(value) : Date.parse(value)
  if (!Number.isFinite(number) || number < 946684800000 || number > 4102444800000) throw new Error('INVALID_TASK_DATE')
  return number
}

function taskScore(value) {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) return { score: null, scoreInvalid: false }
  const validType = typeof value === 'number' || (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()))
  const score = validType ? Number(value) : NaN
  return Number.isFinite(score) && score >= 0 && score <= Number.MAX_SAFE_INTEGER
    ? { score, scoreInvalid: false } : { score: null, scoreInvalid: true }
}

export function dashboardScoreLabel(task) {
  return task.scoreInvalid ? '分值异常' : Number.isFinite(task.score) && task.score >= 0 ? `${task.score}分` : '未设分'
}

export function compareDashboardScores(a, b) {
  const score = task => !task.scoreInvalid && Number.isFinite(task.score) && task.score >= 0 ? task.score : -1
  return score(b) - score(a)
}

// 根据可用区域计算容量，尺寸与卡片样式的最小可读尺寸保持一致。
export function dashboardGridLayout(width, height, gap = 10, fontSize = 16, cardHeight) {
  const scale = Math.max(1, fontSize / 16)
  const columns = Math.max(1, Math.floor((Math.max(0, width) + gap) / (360 * scale + gap)))
  const rowHeight = Number.isFinite(cardHeight) && cardHeight > 0 ? cardHeight : 260 * scale
  const rows = Math.max(1, Math.floor((Math.max(0, height) + gap) / (rowHeight + gap)))
  return { columns, rows, size: columns * rows }
}

// 容量只由窗口决定，不按各页任务的文字长短重新打包；尾页保留不足项。
export function dashboardTaskPages(taskCount, columns, rows) {
  const size = Math.max(1, Math.floor(columns)) * Math.max(1, Math.floor(rows))
  const count = Math.max(0, Math.floor(taskCount))
  return Array.from({ length: Math.ceil(count / size) }, (_, index) => ({
    start: index * size, end: Math.min((index + 1) * size, count)
  }))
}

export function dashboardMemberPath(name, profileNames = []) {
  return profileNames.includes(name) ? `/team/${encodeURIComponent(name)}` : ''
}

export function dashboardTaskGroups(task) {
  return Array.isArray(task.groups) ? task.groups : task.group ? [task.group] : []
}

export function normalizeDashboardRecords(records, overrides = {}, { statusIssues } = {}) {
  const names = { ...DASHBOARD_FIELD_NAMES }
  for (const [key, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(names, key) || typeof value !== 'string' || !value.trim()) throw new Error('INVALID_FIELD_MAP')
    names[key] = [value.trim()]
  }
  return records.flatMap(record => {
    const fields = record.fields || {}
    const field = key => names[key].map(name => fields[name]).find(value => value !== undefined && value !== null && value !== '')
    const title = text(field('title'))
    if (!title) return []
    if (typeof record.record_id !== 'string' || !record.record_id) throw new Error('INVALID_TASK_ID')
    const rawStatus = field('status')
    const status = text(rawStatus)
    const statusMissing = rawStatus === undefined || rawStatus === null
      || (typeof rawStatus === 'string' && !rawStatus.trim()) || (Array.isArray(rawStatus) && !rawStatus.length)
    if (!statusMissing && !['未完成', '已完成'].includes(status)) {
      // 服务可隔离单条状态异常；默认严格校验，绝不猜测为未完成或已完成。
      if (!Array.isArray(statusIssues)) throw new Error('INVALID_TASK_STATUS')
      statusIssues.push({ id: record.record_id, title: title.slice(0, 500), status: status.slice(0, 100) || '无法识别的状态格式' })
      return []
    }
    const priority = text(field('priority'))
    const groupValue = field('group')
    const groups = [...new Set((Array.isArray(groupValue) ? groupValue : [groupValue])
      .map(value => text(value).slice(0, 100)).filter(Boolean))]
    return [{
      id: String(record.record_id), title: title.slice(0, 500), group: groups.join('、'), groups,
      assignees: people(field('assignees')), publishers: people(field('publisher')), publisher: people(field('publisher')).map(person => person.name).join('、'),
      deadline: timestamp(field('deadline')), completedAt: timestamp(field('completedAt')),
      ...taskScore(field('score')),
      // 仅保留旧字段映射/API兼容；当前卡片、排序和总分榜均使用分值。
      priority: /^(高|紧急|P0)(?:$|[-－：:])/i.test(priority) ? 'high' : /^(低|P2)(?:$|[-－：:])/i.test(priority) ? 'low' : 'medium',
      status: status === '已完成' ? 'done' : 'todo', ...(statusMissing ? { statusMissing: true } : {}), note: text(field('note')).slice(0, 3000)
    }]
  })
}

export function dashboardTaskState(task, now = Date.now()) {
  return task.status === 'done' ? 'done' : task.deadline !== null && task.deadline <= now ? 'overdue' : 'todo'
}

export function selectDashboardTasks(tasks, { status = 'todo', group = 'all', search = '', now = Date.now() } = {}) {
  const keyword = search.trim().toLowerCase()
  return tasks.filter(task => (status === 'all' || dashboardTaskState(task, now) === status)
    && (group === 'all' || dashboardTaskGroups(task).includes(group))
    && (!keyword || [task.title, task.group, task.publisher, task.note, ...task.assignees.map(person => person.name)].join(' ').toLowerCase().includes(keyword)))
    .sort((a, b) => status === 'done' ? (b.completedAt || 0) - (a.completedAt || 0)
      : (a.deadline ?? Infinity) - (b.deadline ?? Infinity) || compareDashboardScores(a, b) || a.id.localeCompare(b.id))
}

// 每次从当前记录重算，完成撤回、改分及转交负责人不会累计旧账。
export function dashboardScoreboard(tasks) {
  const totals = new Map(), seen = new Set()
  let missingScoreCount = 0, invalidScoreCount = 0, unassignedCount = 0
  for (const task of tasks) {
    if (seen.has(task.id)) continue
    seen.add(task.id)
    const validScore = !task.scoreInvalid && Number.isFinite(task.score) && task.score >= 0
    if (task.status === 'done') {
      if (task.scoreInvalid) invalidScoreCount++
      else if (!validScore) missingScoreCount++
      if (!task.assignees.length) unassignedCount++
    }
    const peopleSeen = new Set()
    for (const person of task.assignees) {
      if (peopleSeen.has(person.key)) continue
      peopleSeen.add(person.key)
      const entry = totals.get(person.key) || { ...person, score: 0, doneCount: 0 }
      if (task.status === 'done') {
        entry.doneCount++
        // 消除常见小数相加的浮点尾数，避免同分出现虚假先后。
        if (validScore) {
          const total = entry.score + task.score
          entry.score = Number.isInteger(entry.score) && Number.isInteger(task.score) ? total : Number(total.toPrecision(15))
        }
      }
      totals.set(person.key, entry)
    }
  }
  const rows = [...totals.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'zh-CN') || a.key.localeCompare(b.key))
  for (let i = 0; i < rows.length; i++) rows[i].rank = i && rows[i].score === rows[i - 1].score ? rows[i - 1].rank : i + 1
  return { rows, missingScoreCount, invalidScoreCount, unassignedCount }
}

export function dashboardRanks(tasks, status) {
  const totals = new Map()
  for (const task of tasks) {
    if (task.status !== status) continue
    for (const person of task.assignees) {
      const entry = totals.get(person.key) || { ...person, count: 0 }
      entry.count++
      totals.set(person.key, entry)
    }
  }
  return [...totals.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'))
}
