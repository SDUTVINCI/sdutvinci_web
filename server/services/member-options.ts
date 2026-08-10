import { asc, eq } from 'drizzle-orm'
import { getDatabase } from '../db/client'
import { memberCohorts } from '../db/schema'
import { MEMBER_POSITION_OPTIONS } from './member-profile'
import type { MemberProfileSnapshot } from './member-profile'
import { MEMBER_COLLEGE_OPTIONS } from '../../shared/constants/member-colleges'

export const DEFAULT_MEMBER_GROUPS: Record<string, string[]> = {
  legacy: ['机械组', '电控组', '运营组'],
  middle: ['机械组', '控制组', '电路组', '视觉算法组', '运营组'],
  current: ['机械组', '嵌入式组', '软件算法组', '运营组']
}

export const defaultGroupsForGrade = (gradeYear: number) => {
  if (gradeYear <= 2021) return DEFAULT_MEMBER_GROUPS.legacy!
  if (gradeYear <= 2024) return DEFAULT_MEMBER_GROUPS.middle!
  return DEFAULT_MEMBER_GROUPS.current!
}

export const listMemberOptions = async (includeInactive = false) => {
  const rows = await getDatabase().select().from(memberCohorts)
    .where(includeInactive ? undefined : eq(memberCohorts.active, true))
    .orderBy(asc(memberCohorts.gradeYear))
  return {
    cohorts: rows.map(row => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    })),
    positions: [...MEMBER_POSITION_OPTIONS],
    colleges: [...MEMBER_COLLEGE_OPTIONS]
  }
}

export const saveMemberCohort = async (input: {
  gradeYear: number
  season: string
  groups: string[]
  active?: boolean
}) => {
  const groups = [...new Set(input.groups.map(value => value.trim()).filter(Boolean))]
  if (!groups.length || groups.some(value => value.length > 64)) throw new Error('MEMBER_GROUPS_INVALID')
  const [row] = await getDatabase().insert(memberCohorts).values({
    gradeYear: input.gradeYear,
    season: input.season.trim(),
    groups,
    active: input.active ?? true,
    updatedAt: new Date()
  }).onConflictDoUpdate({
    target: memberCohorts.gradeYear,
    set: { season: input.season.trim(), groups, active: input.active ?? true, updatedAt: new Date() }
  }).returning()
  return row!
}

export const assertMemberProfileOptions = async (profile: Pick<MemberProfileSnapshot, 'grade' | 'seasons' | 'advisorSeasons' | 'groupName'>) => {
  if (!profile.grade) return
  const gradeYear = Number(profile.grade)
  const [cohort] = await getDatabase().select().from(memberCohorts)
    .where(eq(memberCohorts.gradeYear, gradeYear)).limit(1)
  if (!cohort || !cohort.active) throw new Error('MEMBER_GRADE_INVALID')
  if (profile.groupName && !cohort.groups.includes(profile.groupName)) throw new Error('MEMBER_GROUP_INVALID')
  const active = await getDatabase().select({ season: memberCohorts.season }).from(memberCohorts)
    .where(eq(memberCohorts.active, true))
  const seasons = new Set(active.map(item => item.season))
  if (profile.seasons.some(season => !seasons.has(season))) throw new Error('MEMBER_SEASON_INVALID')
  if (profile.advisorSeasons.some(season => !seasons.has(season))) throw new Error('MEMBER_ADVISOR_SEASON_INVALID')
}
