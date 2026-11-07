import { dashboardPeople, dashboardLabels } from './dashboard-data.mjs'

export function dashboardMemberIndex(records) {
  const identities = new Map()
  for (const record of records) {
    const fields = record.fields || {}
    const cohorts = dashboardLabels(fields['啥登'])
    const groups = [...new Set(dashboardLabels(fields['组别']).filter(value => !/^opt[A-Za-z0-9]{6,}$/.test(value)))].sort()
    const cohort = cohorts.length === 1 ? ({ 老登: 'senior', 小登: 'junior' }[cohorts[0]] || null) : null
    for (const person of dashboardPeople(fields['飞书账号'])) {
      if (!person.key || person.key === person.name) continue
      const previous = identities.get(person.key)
      const next = { cohort, groups }
      // 重复账号但身份/部门矛盾时不按读取顺序覆盖。
      identities.set(person.key, identities.has(person.key) && JSON.stringify(previous) !== JSON.stringify(next) ? null : next)
    }
  }
  return identities
}

export function applyDashboardMembers(tasks, identities) {
  return tasks.map(task => {
    const assignees = task.assignees.map(person => {
      const member = person.key !== person.name ? identities.get(person.key) : null
      return { ...person, cohort: member?.cohort || null, groups: member?.groups || [] }
    })
    const complete = assignees.length && assignees.every(person => identities.get(person.key))
    const groups = complete ? [...new Set(assignees.flatMap(person => person.groups))] : [...(task.groups || [])]
    const cohorts = [...new Set(assignees.flatMap(person => person.cohort ? [person.cohort === 'senior' ? '老登' : '小登'] : []))]
    return { ...task, assignees, groups, group: groups.join('、'), cohorts }
  })
}
const handle = value => typeof value === 'string' && /^[a-z\d_.-]+$/i.test(value) && !['.', '..'].includes(value) ? value.toLowerCase() : ''

// “啥登”来自成员表查找引用。只有可唯一对应的账号进入分榜，不按姓名或年级猜测。
export function dashboardCohortRanking(rows, tasks, cohort = 'all') {
  const identities = new Map()
  const authoritative = new Set()
  for (const task of tasks) for (const person of task.assignees || []) {
    if (!Object.hasOwn(person, 'cohort') || !person.key || person.key === person.name) continue
    const value = ['senior', 'junior'].includes(person.cohort) ? person.cohort : null
    identities.set(person.key, identities.has(person.key) && identities.get(person.key) !== value ? null : value)
    authoritative.add(person.key)
  }
  for (const task of tasks) {
    if (task.assignees?.length !== 1) continue
    const person = task.assignees[0]
    if (!person.key || person.key === person.name || authoritative.has(person.key)) continue
    const labels = task.cohorts || []
    const value = labels.length === 1 ? ({ 老登: 'senior', 小登: 'junior' }[labels[0]] || null) : null
    identities.set(person.key, identities.has(person.key) && identities.get(person.key) !== value ? null : value)
  }
  const selected = rows.filter(row => cohort === 'all' || identities.get(row.key) === cohort).map(row => ({ ...row }))
  // 保留原始积分排序，按当前榜单重排；同分仍并列，不修改总榜。
  for (let i = 0; i < selected.length; i++) {
    selected[i].rank = i && selected[i].score === selected[i - 1].score ? selected[i - 1].rank : i + 1
  }
  return { rows: selected, unmatchedCount: rows.filter(row => !identities.get(row.key)).length }
}

export function githubProfileLogin(value) {
  if (typeof value !== 'string') return ''
  const match = /^https:\/\/github\.com\/([a-z\d_.-]+)\/?$/i.exec(value)
  return match ? handle(match[1]) : ''
}

function destination(value) {
  return typeof value === 'string' && /^https:\/\/github\.com(?:\/[a-z\d_.-]+(?:\/[a-z\d_.-]+)?)?\/?$/i.test(value)
    && !value.split('/').some(part => part === '.' || part === '..') ? value : ''
}

export function dashboardCodeProfile(person, members = [], logo = '') {
  const login = githubProfileLogin(person.href) || handle(person.login) || handle(person.name)
  const matches = person.memberName ? members.filter(member => member.name === person.memberName)
    : login ? members.filter(member => githubProfileLogin(member.links?.github) === login) : []
  const member = matches.length === 1 ? matches[0] : null
  if (member) return { name: member.name, image: member.image || logo,
    href: typeof member.memberKey === 'string' && member.memberKey ? `/team/${encodeURIComponent(member.memberKey)}` : '', external: false }
  return { name: person.name || 'GitHub', image: logo, href: destination(person.href) || 'https://github.com', external: true }
}
