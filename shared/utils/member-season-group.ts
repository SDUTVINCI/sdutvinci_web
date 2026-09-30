type TeamMember = {
  role?: string | null
  type?: string | null
  group?: string | null
  time?: string | null
  advisor?: string | null
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
  if (participates && type.includes('团队负责人')) return 'leaders'
  if (consulting.length && (season === 'all' || consulting.includes(season) && !participation.includes(season))) {
    return 'advisors'
  }
  return 'others'
}
