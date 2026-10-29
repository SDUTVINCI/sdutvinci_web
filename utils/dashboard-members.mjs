
const handle = value => typeof value === 'string' && /^[a-z\d_.-]+$/i.test(value) && !['.', '..'].includes(value) ? value.toLowerCase() : ''

// 飞书只提供姓名，没有网站 memberKey；两边姓名均唯一时才采用档案年级。
export function dashboardCohortRanking(rows, members, season, cohort = 'all') {
  const profiles = new Map(), names = new Map()
  for (const member of members) {
    profiles.set(member.name, profiles.has(member.name) ? null : member)
  }
  for (const row of rows) names.set(row.name, (names.get(row.name) || 0) + 1)
  const gradeFor = row => {
    const profile = names.get(row.name) === 1 ? profiles.get(row.name) : null
    const match = /^(20\d{2})(?:\s*级)?$/.exec(String(profile?.grade ?? '').trim())
    return match ? Number(match[1]) : null
  }
  const grade = cohort === 'senior' ? season - 2 : cohort === 'junior' ? season - 1 : null
  const selected = rows.filter(row => cohort === 'all' || gradeFor(row) === grade).map(row => ({ ...row }))
  // 保留原始积分排序，按当前榜单重排；同分仍并列，不修改总榜。
  for (let i = 0; i < selected.length; i++) {
    selected[i].rank = i && selected[i].score === selected[i - 1].score ? selected[i - 1].rank : i + 1
  }
  return { rows: selected, grade, unmatchedCount: rows.filter(row => gradeFor(row) === null).length }
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
