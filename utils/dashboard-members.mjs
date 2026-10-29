
const handle = value => typeof value === 'string' && /^[a-z\d_.-]+$/i.test(value) && !['.', '..'].includes(value) ? value.toLowerCase() : ''

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
