type TeamMember = {
  role?: string | null
  type?: string | null
  group?: string | null
  time?: string | null
  advisor?: string | null
  positions?: readonly string[] | null
}

const seasons = (value: string | null | undefined) => String(value ?? '')
  .split(/\/|,|，/).map(part => part.trim()).filter(Boolean)

export const memberSeasonGroup = (member: TeamMember, season: string, configuredGroups: readonly string[]) => {
  const role = String(member.role ?? '').toLowerCase()
  const type = String(member.type ?? '').toLowerCase()
  if (type.includes('指导老师') || role.includes('指导老师')) return 'teachers'

  const participation = seasons(member.time)
  const consulting = seasons(member.advisor)
  const participates = season === 'all' || participation.includes(season)
  const group = configuredGroups.find(item => item.toLowerCase() === String(member.group ?? '').toLowerCase())
  if (participates && group) return `group:${group}`
  if (consulting.length && (season === 'all' || consulting.includes(season) && !participation.includes(season))) {
    return 'advisors'
  }
  return 'others'
}

const teamOfficePositions = new Set(['队长', '副队长', '机电创新学会会长'])

export const orderMembersInGroup = <T extends TeamMember>(members: readonly T[]) =>
  [...members].sort((left, right) =>
    Number(Boolean(right.positions?.some(position => teamOfficePositions.has(position))))
    - Number(Boolean(left.positions?.some(position => teamOfficePositions.has(position))))
  )
