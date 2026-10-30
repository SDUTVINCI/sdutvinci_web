
const handle = value => typeof value === 'string' && /^[a-z\d_.-]+$/i.test(value) && !['.', '..'].includes(value) ? value.toLowerCase() : ''

// “啥登”来自成员表查找引用。只有可唯一对应的账号进入分榜，不按姓名或年级猜测。
export function dashboardCohortRanking(rows, tasks, cohort = 'all') {
  const identities = new Map()
  for (const task of tasks) {
    if (task.assignees?.length !== 1) continue
    const person = task.assignees[0]
    if (!person.key || person.key === person.name) continue
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
