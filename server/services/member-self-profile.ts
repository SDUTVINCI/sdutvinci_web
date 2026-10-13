import { randomUUID } from 'node:crypto'
import { and, asc, eq, isNull, lt } from 'drizzle-orm'
import type { CmsUser } from '../../shared/types/cms-auth'
import type { MemberProfileFormModel } from '../../shared/types/member-profile-form'
import { getDatabase } from '../db/client'
import { auditLogs, memberProfileUploads, memberProposals, members } from '../db/schema'
import { CmsMemberVersionConflictError, getCmsMember, rejectMemberProposal } from './cms-members'
import { assertLearnerProfile, deriveMemberRole, deriveMemberType, memberFieldDiff, normalizeEditableMemberRoles, profileFromRecord, profileRecord, serializeMemberProfile } from './member-profile'
import { assertMemberProfileOptions } from './member-options'
import { MEMBER_COLLEGE_OPTIONS } from '../../shared/constants/member-colleges'
import { deleteMemberAvatarObject, prepareMemberAvatar, uploadMemberAvatarObject } from './member-avatar-storage'

export const getOwnMemberProfile = async (user: CmsUser) => {
  const member = user.memberId ? await getCmsMember(user.memberId) : null
  if (!member || member.deletedAt || !member.currentRevisionId) throw new Error('MEMBER_NOT_FOUND')
  return member
}

export const listOwnMemberProposals = async (user: CmsUser) => {
  const member = await getOwnMemberProfile(user)
  return getDatabase().select().from(memberProposals)
    .where(and(eq(memberProposals.memberId, member.id), eq(memberProposals.createdByUserId, user.id)))
    .orderBy(asc(memberProposals.createdAt))
}

export const submitOwnMemberProfile = async (
  user: CmsUser,
  input: MemberProfileFormModel & { avatarUrl: string, expectedVersion: number }
) => getDatabase().transaction(async tx => {
  if (!user.memberId) throw new Error('MEMBER_NOT_FOUND')
  const [current] = await tx.select().from(members).where(eq(members.id, user.memberId)).for('update')
  if (!current || current.deletedAt || !current.currentRevisionId) throw new Error('MEMBER_NOT_FOUND')
  if (current.version !== input.expectedVersion) throw new CmsMemberVersionConflictError()
  const [pending] = await tx.select({ id: memberProposals.id }).from(memberProposals)
    .where(and(eq(memberProposals.memberId, current.id), eq(memberProposals.createdByUserId, user.id), eq(memberProposals.status, 'pending'))).limit(1)
  if (pending) throw new Error('MEMBER_PROFILE_PENDING')
  const before = profileFromRecord({ ...current, sourcePath: current.sourcePath || `cms/${current.memberKey}.md` })
  const isLearner = input.isLearner === true
  const positions = normalizeEditableMemberRoles({ ...input, isLearner, grade: input.grade || null, groupName: input.groupName || null })
  const links = { ...before.links }
  for (const [field, value] of Object.entries(input.links)) {
    const key = field === 'home-page' && !('home-page' in links) && 'homepage' in links ? 'homepage' : field
    if (value.trim()) links[key] = value.trim()
    else if (key in links) links[key] = null
  }
  const next = { ...before, isLearner, name: input.name.trim(), avatarUrl: input.avatarUrl,
    grade: input.grade || null, groupName: input.groupName || null, positions,
    seasons: [...new Set(input.seasons)], advisorSeasons: [...new Set(input.advisorSeasons)],
    affiliation: input.affiliation || null, body: input.body,
    links,
    role: deriveMemberRole(positions, input.groupName || null, isLearner),
    memberType: deriveMemberType(positions, input.groupName || null, isLearner)
  }
  assertLearnerProfile(next)
  if ((!next.grade && before.grade) || !next.avatarUrl || (!isLearner && !positions.length)
    || (!isLearner && !positions.includes('指导老师') && !(before.positions.includes('顾问') && positions.includes('顾问') && !before.seasons.length) && !next.seasons.length)) throw new Error('MEMBER_PROFILE_INCOMPLETE')
  if (next.affiliation && next.affiliation !== before.affiliation
    && !(MEMBER_COLLEGE_OPTIONS as readonly string[]).includes(next.affiliation)) throw new Error('MEMBER_COLLEGE_INVALID')
  await assertMemberProfileOptions(next, before)
  serializeMemberProfile(next)
  let uploadId: string | undefined
  if (next.avatarUrl !== current.avatarUrl) {
    const [upload] = await tx.select().from(memberProfileUploads).where(and(
      eq(memberProfileUploads.userId, user.id), eq(memberProfileUploads.memberId, current.id),
      eq(memberProfileUploads.url, next.avatarUrl), isNull(memberProfileUploads.proposalId)
    )).limit(1).for('update')
    if (!upload || upload.expiresAt < new Date()) throw new Error('MEMBER_AVATAR_UPLOAD_INVALID')
    uploadId = upload.id
  }
  const changes = memberFieldDiff(before, next)
  if (!Object.keys(changes).length) throw new Error('MEMBER_PROFILE_UNCHANGED')
  const [proposal] = await tx.insert(memberProposals).values({
    memberId: current.id, baseRevisionId: current.currentRevisionId, currentRevisionId: current.currentRevisionId,
    action: 'update', status: 'pending', proposedProfile: profileRecord(next), fieldChanges: changes, createdByUserId: user.id
  }).returning()
  if (uploadId) await tx.update(memberProfileUploads).set({ proposalId: proposal!.id }).where(eq(memberProfileUploads.id, uploadId))
  await tx.insert(auditLogs).values({ actorUserId: user.id, action: 'member.profile.submit', targetType: 'member_proposal', targetId: proposal!.id,
    metadata: { memberId: current.id, changedFields: Object.keys(changes) } })
  return proposal!
})

export const uploadOwnMemberAvatar = async (user: CmsUser, input: { expectedVersion: number, name: string, data: Buffer, mimeType: string }) => {
  const member = await getOwnMemberProfile(user)
  if (member.version !== input.expectedVersion) throw new CmsMemberVersionConflictError()
  const { output, filename } = await prepareMemberAvatar(input)
  const key = `site-assets/images/member_photo/proposals/${randomUUID()}/${filename}`
  const { url } = await uploadMemberAvatarObject({ key, output, cacheControl: 'private, max-age=86400', metadata: { 'member-id': member.id } })
  try {
    await getDatabase().insert(memberProfileUploads).values({ userId: user.id, memberId: member.id, objectKey: key, url,
      expiresAt: new Date(Date.now() + 24 * 60 * 60_000) })
  } catch (error) { await deleteMemberAvatarObject(key).catch(() => undefined); throw error }
  return { url, filename }
}

export const cleanupUnusedMemberProfileUploads = async () => {
  const expired = await getDatabase().select({ id: memberProfileUploads.id }).from(memberProfileUploads)
    .where(and(isNull(memberProfileUploads.proposalId), lt(memberProfileUploads.expiresAt, new Date()))).limit(100)
  for (const upload of expired) await getDatabase().transaction(async tx => {
    const [current] = await tx.select().from(memberProfileUploads).where(eq(memberProfileUploads.id, upload.id)).for('update')
    if (!current || current.proposalId || current.expiresAt >= new Date()) return
    try { await deleteMemberAvatarObject(current.objectKey) } catch { return }
    await tx.delete(memberProfileUploads).where(eq(memberProfileUploads.id, current.id))
  })
}

export const listPendingMemberProfileProposals = async () => getDatabase().select({ proposal: memberProposals, memberName: members.name, version: members.version })
  .from(memberProposals).innerJoin(members, eq(members.id, memberProposals.memberId))
  .where(and(eq(memberProposals.status, 'pending'), isNull(members.deletedAt)))
  .orderBy(asc(memberProposals.createdAt))

export const rejectMemberProfileProposal = async (id: string, note: string, actorUserId: string) => rejectMemberProposal(id, note, actorUserId)

export const withdrawOwnMemberProposal = async (user: CmsUser, id: string) => getDatabase().transaction(async tx => {
  const [proposal] = await tx.select().from(memberProposals).where(and(
    eq(memberProposals.id, id), eq(memberProposals.memberId, user.memberId || '00000000-0000-0000-0000-000000000000'),
    eq(memberProposals.createdByUserId, user.id)
  )).for('update')
  if (!proposal || proposal.status !== 'pending') throw new Error('MEMBER_PROPOSAL_NOT_PENDING')
  await tx.update(memberProposals).set({ status: 'rejected', reviewNote: '本人撤回修改', resolvedAt: new Date() }).where(eq(memberProposals.id, id))
  await tx.update(memberProfileUploads).set({ proposalId: null, expiresAt: new Date() }).where(eq(memberProfileUploads.proposalId, id))
  await tx.insert(auditLogs).values({ actorUserId: user.id, action: 'member.profile.withdraw', targetType: 'member_proposal', targetId: id })
})
