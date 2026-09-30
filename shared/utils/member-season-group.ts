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

const positionOrder = ['队长', '副队长', '机电创新学会会长', '组长', '成员'] as const
const positionPriority = (member: TeamMember) => Math.min(
  ...(member.positions ?? []).map(position => {
    const index = positionOrder.findIndex(item => item === position)
    return index < 0 ? positionOrder.length : index
  }),
  positionOrder.length
)

export const orderMembersInGroup = <T extends TeamMember>(members: readonly T[]) =>
  [...members].sort((left, right) => positionPriority(left) - positionPriority(right))
