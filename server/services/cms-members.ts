import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { CmsMember, CmsMemberInput } from '../../shared/types/cms-members'
import { getDatabase } from '../db/client'
import {
  auditLogs,
  articleCreditIdentities,
  contentExportJobs,
  memberProposals,
  memberRevisions,
  members,
  userMembers,
  users
} from '../db/schema'
import { listMarkdownFiles, readContentFile } from '../utils/cms-content-path'
import { assertMemberProfileOptions } from './member-options'
import {
  assertSafeMemberAvatarUrl,
  deriveMemberRole,
  deriveMemberType,
  memberProfileFromMarkdown,
  memberFieldDiff,
  profileFromRecord,
  profileRecord,
  normalizeMemberPositions,
  serializeMemberProfile,
  type MemberProfileSnapshot
} from './member-profile'

export class CmsMemberVersionConflictError extends Error {
  constructor() {
    super('成员资料已被其他操作更新，请刷新后重试')
    this.name = 'CmsMemberVersionConflictError'
  }
}

export class CmsMemberBindingConflictError extends Error {
  constructor() {
    super('账号或成员已经绑定其他对象')
    this.name = 'CmsMemberBindingConflictError'
  }
}

const safeSourcePath = (value: string) => {
  const normalized = value.trim().normalize('NFC').replaceAll('\\', '/')
  if (!normalized || normalized.length > 400 || normalized.startsWith('/')
    || !normalized.endsWith('.md') || normalized.includes('\0')
    || normalized.split('/').some(segment => !segment || segment === '.' || segment === '..' || segment === '.git')) {
    throw new Error('MEMBER_SOURCE_PATH_INVALID')
  }
  return normalized
}

const memberSelection = {
  id: members.id,
  memberKey: members.memberKey,
  name: members.name,
  avatarUrl: members.avatarUrl,
  sourcePath: members.sourcePath,
  role: members.role,
  memberType: members.memberType,
  groupName: members.groupName,
  positions: members.positions,
  seasons: members.seasons,
  advisorSeasons: members.advisorSeasons,
  grade: members.grade,
  affiliation: members.affiliation,
  links: members.links,
  body: members.body,
  sortOrder: members.sortOrder,
  version: members.version,
  currentRevisionId: members.currentRevisionId,
  metadata: members.metadata,
  deletedAt: members.deletedAt,
  linkedUserId: users.id,
  linkedAccount: users.account,
  createdAt: members.createdAt,
  updatedAt: members.updatedAt
}

const toCmsMember = (row: Awaited<ReturnType<typeof loadMemberRows>>[number]): CmsMember => ({
  ...row,
  sourcePath: row.sourcePath || '',
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  deletedAt: row.deletedAt?.toISOString() || null
})

const loadMemberRows = async (id?: string, includeDeleted = true) => {
  const query = getDatabase()
    .select(memberSelection)
    .from(members)
    .leftJoin(userMembers, eq(members.id, userMembers.memberId))
    .leftJoin(users, eq(userMembers.userId, users.id))
    .orderBy(asc(members.sortOrder), asc(members.memberKey))
  const filters = [
    ...(id ? [eq(members.id, id)] : []),
    ...(!includeDeleted ? [isNull(members.deletedAt)] : [])
  ]
  return filters.length ? query.where(and(...filters)) : query
}

export const listCmsMembers = async (includeDeleted = true): Promise<CmsMember[]> =>
  (await loadMemberRows(undefined, includeDeleted)).map(toCmsMember)

export const getCmsMember = async (id: string) =>
  loadMemberRows(id).then(rows => rows[0] ? toCmsMember(rows[0]) : null)

const profileFromMemberRow = (row: typeof members.$inferSelect): MemberProfileSnapshot => ({
  memberKey: row.memberKey,
  name: row.name,
  avatarUrl: row.avatarUrl,
  sourcePath: row.sourcePath || `cms/${row.memberKey}.md`,
  role: row.role,
  memberType: row.memberType,
  groupName: row.groupName,
  positions: row.positions,
  seasons: row.seasons,
  advisorSeasons: row.advisorSeasons,
  grade: row.grade,
  affiliation: row.affiliation,
  links: row.links,
  body: row.body,
  sortOrder: row.sortOrder,
  metadata: row.metadata
})

const memberValues = (profile: MemberProfileSnapshot) => ({
  memberKey: profile.memberKey,
  name: profile.name,
  avatarUrl: profile.avatarUrl,
  sourcePath: safeSourcePath(profile.sourcePath),
  role: profile.role,
  memberType: profile.memberType,
  groupName: profile.groupName,
  positions: profile.positions,
  seasons: profile.seasons,
  advisorSeasons: profile.advisorSeasons,
  grade: profile.grade,
  affiliation: profile.affiliation,
  links: profile.links,
  body: profile.body,
  sortOrder: profile.sortOrder,
  metadata: profile.metadata
})

const appendRevisionAndOutbox = async (
  tx: Parameters<Parameters<ReturnType<typeof getDatabase>['transaction']>[0]>[0],
  input: {
    memberId: string
    revisionNumber: number
    profile: MemberProfileSnapshot
    sourceKind: 'backfill' | 'cms_create' | 'cms_update' | 'proposal_apply' | 'restore' | 'delete'
    actorUserId: string | null
    sourceProposalId?: string | null
    restoredFromRevisionId?: string | null
    operation?: 'create' | 'member_update' | 'delete'
  }
) => {
  const serialized = serializeMemberProfile(input.profile)
  const revisionId = randomUUID()
  await tx.insert(memberRevisions).values({
    id: revisionId,
    memberId: input.memberId,
    revisionNumber: input.revisionNumber,
    memberKey: input.profile.memberKey,
    sourcePath: input.profile.sourcePath,
    profile: profileRecord(input.profile),
    markdownSource: serialized.source,
    contentHash: serialized.sha256,
    sourceKind: input.sourceKind,
    actorUserId: input.actorUserId,
    sourceProposalId: input.sourceProposalId || null,
    restoredFromRevisionId: input.restoredFromRevisionId || null
  })
  const operation = input.operation || 'member_update'
  const [job] = await tx.insert(contentExportJobs).values({
    targetType: 'member',
    targetId: input.memberId,
    memberRevisionId: revisionId,
    operation,
    idempotencyKey: `member:${input.memberId}:${revisionId}:${operation}`,
    targetPath: serialized.path,
    expectedSha256: serialized.sha256
  }).returning({ id: contentExportJobs.id })
  return { revisionId, jobId: job!.id, serialized }
}

const inputProfile = (
  input: CmsMemberInput & { memberKey: string },
  sourcePath: string
): MemberProfileSnapshot => {
  const groupName = input.groupName?.trim() || null
  const positions = normalizeMemberPositions(input.positions || [])
  const profile: MemberProfileSnapshot = {
    memberKey: input.memberKey.trim().toLowerCase(),
    name: input.name.trim(),
    avatarUrl: input.avatarUrl ?? null,
    sourcePath: safeSourcePath(sourcePath),
    role: deriveMemberRole(positions, groupName),
    memberType: deriveMemberType(positions, groupName),
    groupName,
    positions,
    seasons: input.seasons || [],
    advisorSeasons: input.advisorSeasons || [],
    grade: input.grade?.trim() || null,
    affiliation: input.affiliation?.trim() || null,
    links: input.links || {},
    body: input.body || '',
    sortOrder: input.sortOrder ?? 0,
    metadata: input.metadata || {}
  }
  assertSafeMemberAvatarUrl(profile.avatarUrl)
  serializeMemberProfile(profile)
  return profile
}

export const createCmsMember = async (
  input: CmsMemberInput & { memberKey: string },
  actorUserId: string
) => {
  const profile = inputProfile(input, input.sourcePath || `cms/${input.memberKey.trim().toLowerCase()}.md`)
  await assertMemberProfileOptions(profile)
  const memberId = randomUUID()
  await getDatabase().transaction(async (tx) => {
    await tx.insert(members).values({ id: memberId, ...memberValues(profile) })
    await tx.update(articleCreditIdentities).set({
      memberId,
      version: sql`${articleCreditIdentities.version} + 1`,
      updatedAt: new Date()
    }).where(eq(articleCreditIdentities.creditKey, profile.memberKey))
    const result = await appendRevisionAndOutbox(tx, {
      memberId,
      revisionNumber: 1,
      profile,
      sourceKind: 'cms_create',
      actorUserId,
      operation: 'create'
    })
    await tx.update(members).set({ currentRevisionId: result.revisionId })
      .where(eq(members.id, memberId))
    const [matchingUser] = await tx.select({ id: users.id }).from(users)
      .where(eq(users.account, profile.memberKey)).limit(1)
    if (matchingUser) {
      await tx.insert(userMembers).values({ userId: matchingUser.id, memberId })
        .onConflictDoNothing()
    }
    await tx.insert(auditLogs).values({
      actorUserId,
      action: 'member.create',
      targetType: 'member',
      targetId: memberId,
      metadata: {
        memberKey: profile.memberKey,
        revisionId: result.revisionId,
        exportJobId: result.jobId,
        changedFields: ['name', 'image', 'role', 'type', 'time', 'advisor', 'grade', 'affiliation', 'links', 'body', 'metadata', 'sortOrder']
      }
    })
  })
  return getCmsMember(memberId)
}

export const updateCmsMember = async (
  id: string,
  input: Omit<CmsMemberInput, 'memberKey' | 'directory' | 'sourcePath'> & { expectedVersion?: number },
  actorUserId: string
) => {
  await getDatabase().transaction(async (tx) => {
    const [current] = await tx.select().from(members).where(eq(members.id, id)).limit(1).for('update')
    if (!current) return
    if (input.expectedVersion !== undefined && current.version !== input.expectedVersion) {
      throw new CmsMemberVersionConflictError()
    }
    const before = profileFromMemberRow(current)
    const next = inputProfile({
      memberKey: current.memberKey,
      name: input.name,
      avatarUrl: input.avatarUrl === undefined ? before.avatarUrl : input.avatarUrl,
      groupName: input.groupName === undefined ? before.groupName : input.groupName,
      positions: input.positions === undefined ? before.positions : input.positions,
      seasons: input.seasons === undefined ? before.seasons : input.seasons,
      advisorSeasons: input.advisorSeasons === undefined ? before.advisorSeasons : input.advisorSeasons,
      grade: input.grade === undefined ? before.grade : input.grade,
      affiliation: input.affiliation === undefined ? before.affiliation : input.affiliation,
      links: input.links === undefined ? before.links : input.links,
      body: input.body === undefined ? before.body : input.body,
      sortOrder: input.sortOrder === undefined ? before.sortOrder : input.sortOrder,
      metadata: input.metadata === undefined ? before.metadata : input.metadata
    }, before.sourcePath)
    const changes = memberFieldDiff(before, next)
    await assertMemberProfileOptions(next)
    if (!Object.keys(changes).length) return
    const revisionNumber = (await tx.select({ value: sql<number>`coalesce(max(${memberRevisions.revisionNumber}), 0)::int` })
      .from(memberRevisions).where(eq(memberRevisions.memberId, id)))[0]!.value + 1
    const result = await appendRevisionAndOutbox(tx, {
      memberId: id,
      revisionNumber,
      profile: next,
      sourceKind: 'cms_update',
      actorUserId
    })
    const [updated] = await tx.update(members).set({
      ...memberValues(next),
      currentRevisionId: result.revisionId,
      version: current.version + 1,
      updatedAt: new Date()
    }).where(and(eq(members.id, id), eq(members.version, current.version)))
      .returning({ id: members.id })
    if (!updated) throw new CmsMemberVersionConflictError()
    await tx.insert(auditLogs).values({
      actorUserId,
      action: 'member.update',
      targetType: 'member',
      targetId: id,
      metadata: {
        memberKey: current.memberKey,
        previousRevisionId: current.currentRevisionId,
        revisionId: result.revisionId,
        exportJobId: result.jobId,
        changedFields: Object.keys(changes),
        before: Object.fromEntries(Object.keys(changes).map(key => [key, changes[key]!.from])),
        after: Object.fromEntries(Object.keys(changes).map(key => [key, changes[key]!.to]))
      }
    })
  })
  return getCmsMember(id)
}

export const deleteCmsMember = async (
  id: string,
  expectedVersion: number,
  actorUserId: string
) => {
  await getDatabase().transaction(async (tx) => {
    const [current] = await tx.select().from(members).where(eq(members.id, id)).limit(1).for('update')
    if (!current || current.deletedAt) throw new Error('MEMBER_NOT_FOUND')
    if (current.version !== expectedVersion) throw new CmsMemberVersionConflictError()
    const profile = profileFromMemberRow(current)
    const revisionNumber = (await tx.select({ value: sql<number>`coalesce(max(${memberRevisions.revisionNumber}), 0)::int` })
      .from(memberRevisions).where(eq(memberRevisions.memberId, id)))[0]!.value + 1
    const result = await appendRevisionAndOutbox(tx, {
      memberId: id,
      revisionNumber,
      profile,
      sourceKind: 'delete',
      actorUserId,
      operation: 'delete'
    })
    const now = new Date()
    const [deleted] = await tx.update(members).set({
      currentRevisionId: result.revisionId,
      version: current.version + 1,
      deletedAt: now,
      deletedByUserId: actorUserId,
      updatedAt: now
    }).where(and(eq(members.id, id), eq(members.version, current.version)))
      .returning({ id: members.id })
    if (!deleted) throw new CmsMemberVersionConflictError()
    await tx.delete(userMembers).where(eq(userMembers.memberId, id))
    await tx.insert(auditLogs).values({
      actorUserId,
      action: 'member.delete',
      targetType: 'member',
      targetId: id,
      metadata: {
        memberKey: current.memberKey,
        previousRevisionId: current.currentRevisionId,
        revisionId: result.revisionId,
        exportJobId: result.jobId
      }
    })
  })
  return getCmsMember(id)
}

export const bindCmsMemberAccount = async (
  memberId: string,
  userId: string | null,
  actorUserId: string
) => {
  try {
    await getDatabase().transaction(async (tx) => {
      const [member] = await tx.select({ id: members.id, memberKey: members.memberKey })
        .from(members).where(eq(members.id, memberId)).limit(1).for('update')
      if (!member) throw new Error('MEMBER_NOT_FOUND')
      const [before] = await tx.select({ userId: userMembers.userId }).from(userMembers)
        .where(eq(userMembers.memberId, memberId)).limit(1)
      await tx.delete(userMembers).where(eq(userMembers.memberId, memberId))
      if (userId) {
        const [user] = await tx.select({ id: users.id }).from(users)
          .where(eq(users.id, userId)).limit(1).for('update')
        if (!user) throw new Error('USER_NOT_FOUND')
        await tx.insert(userMembers).values({ userId, memberId })
      }
      await tx.insert(auditLogs).values({
        actorUserId,
        action: 'member.binding.update',
        targetType: 'member',
        targetId: memberId,
        metadata: { memberKey: member.memberKey, previousUserId: before?.userId || null, userId }
      })
    })
  } catch (error) {
    if (typeof error === 'object' && error && 'code' in error && error.code === '23505') {
      throw new CmsMemberBindingConflictError()
    }
    throw error
  }
  return getCmsMember(memberId)
}

export const listCmsMemberRevisions = async (memberId: string) =>
  getDatabase().select({
    id: memberRevisions.id,
    revisionNumber: memberRevisions.revisionNumber,
    sourceKind: memberRevisions.sourceKind,
    contentHash: memberRevisions.contentHash,
    createdAt: memberRevisions.createdAt,
    actorUserId: memberRevisions.actorUserId,
    restoredFromRevisionId: memberRevisions.restoredFromRevisionId
  }).from(memberRevisions).where(eq(memberRevisions.memberId, memberId))
    .orderBy(asc(memberRevisions.revisionNumber))

export const restoreCmsMemberRevision = async (
  memberId: string,
  revisionId: string,
  expectedVersion: number,
  actorUserId: string
) => {
  await getDatabase().transaction(async (tx) => {
    const [current] = await tx.select().from(members).where(eq(members.id, memberId)).limit(1).for('update')
    if (!current) throw new Error('MEMBER_NOT_FOUND')
    if (current.version !== expectedVersion) throw new CmsMemberVersionConflictError()
    const [target] = await tx.select().from(memberRevisions).where(and(
      eq(memberRevisions.id, revisionId), eq(memberRevisions.memberId, memberId)
    )).limit(1)
    if (!target) throw new Error('MEMBER_REVISION_NOT_FOUND')
    const profile = profileFromRecord(target.profile)
    if (profile.memberKey !== current.memberKey) throw new Error('MEMBER_KEY_IMMUTABLE')
    const result = await appendRevisionAndOutbox(tx, {
      memberId,
      revisionNumber: target.revisionNumber > 0
        ? (await tx.select({ value: sql<number>`max(${memberRevisions.revisionNumber})::int` })
            .from(memberRevisions).where(eq(memberRevisions.memberId, memberId)))[0]!.value + 1
        : 1,
      profile,
      sourceKind: 'restore',
      actorUserId,
      restoredFromRevisionId: revisionId
    })
    await tx.update(members).set({
      ...memberValues(profile),
      currentRevisionId: result.revisionId,
      version: current.version + 1,
      deletedAt: null,
      deletedByUserId: null,
      updatedAt: new Date()
    }).where(eq(members.id, memberId))
    await tx.insert(auditLogs).values({
      actorUserId,
      action: 'member.revision.restore',
      targetType: 'member',
      targetId: memberId,
      metadata: { fromRevisionId: current.currentRevisionId, restoredFromRevisionId: revisionId, revisionId: result.revisionId }
    })
  })
  return getCmsMember(memberId)
}

interface ScannedMemberMigration {
  profile: MemberProfileSnapshot
  source: string
}

const scanMemberMarkdown = async (): Promise<ScannedMemberMigration[]> => {
  const paths = await listMarkdownFiles('members')
  const result: ScannedMemberMigration[] = []
  const keys = new Set<string>()
  for (const [sortOrder, sourcePath] of paths.entries()) {
    const { source } = await readContentFile('members', sourcePath)
    const profile = memberProfileFromMarkdown(source, sourcePath, {
      allowLegacyUnknownFields: true,
      sortOrder
    })
    if (keys.has(profile.memberKey)) throw new Error(`MEMBER_MIGRATION_DUPLICATE_KEY:${profile.memberKey}`)
    keys.add(profile.memberKey)
    result.push({ profile, source })
  }
  return result
}

export const planCmsMemberMarkdownMigration = async () => {
  const scanned = await scanMemberMarkdown()
  const existing = await getDatabase().select().from(members).orderBy(asc(members.memberKey))
  const existingKeys = new Set(existing.map(item => item.memberKey))
  const scannedKeys = new Set(scanned.map(item => item.profile.memberKey))
  const blockers = existing
    .filter(item => !scannedKeys.has(item.memberKey))
    .map(item => `DATABASE_MEMBER_NOT_IN_MARKDOWN:${item.memberKey}`)
  const items = scanned.map((item) => {
    const current = existing.find(row => row.memberKey === item.profile.memberKey)
    return {
      memberKey: item.profile.memberKey,
      sourcePath: item.profile.sourcePath,
      action: current?.currentRevisionId ? 'noop' as const : current ? 'upgrade' as const : 'create' as const,
      existingId: current?.id || null,
      seasons: item.profile.seasons,
      advisorSeasons: item.profile.advisorSeasons,
      serializedSha256: serializeMemberProfile(item.profile).sha256
    }
  })
  return {
    markdownCount: scanned.length,
    databaseCount: existing.length,
    memberKeysEqual: existing.length === 0 || (
      existingKeys.size === scannedKeys.size && [...existingKeys].every(key => scannedKeys.has(key))
    ),
    blockers,
    items,
    scanned
  }
}

export const applyCmsMemberMarkdownMigration = async () => {
  const plan = await planCmsMemberMarkdownMigration()
  if (plan.blockers.length || !plan.memberKeysEqual) throw new Error('MEMBER_MIGRATION_RECONCILIATION_FAILED')
  await getDatabase().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('vinci:v2:member-markdown-migration', 0))`)
    for (const item of plan.scanned) {
      const [existing] = await tx.select().from(members)
        .where(eq(members.memberKey, item.profile.memberKey)).limit(1).for('update')
      const memberId = existing?.id || randomUUID()
      if (!existing) await tx.insert(members).values({ id: memberId, ...memberValues(item.profile) })
      else if (!existing.currentRevisionId) await tx.update(members).set({
        ...memberValues(item.profile), updatedAt: new Date()
      }).where(eq(members.id, memberId))
      if (!existing?.currentRevisionId) {
        const result = await appendRevisionAndOutbox(tx, {
          memberId,
          revisionNumber: 1,
          profile: item.profile,
          sourceKind: 'backfill',
          actorUserId: null
        })
        await tx.update(members).set({ currentRevisionId: result.revisionId })
          .where(eq(members.id, memberId))
      }
    }
    const links = await tx.select({ userId: users.id, memberId: members.id })
      .from(users).innerJoin(members, eq(users.account, members.memberKey))
    if (links.length) await tx.insert(userMembers).values(links).onConflictDoNothing()
    await tx.insert(auditLogs).values({
      actorUserId: null,
      action: 'member.migration.apply',
      targetType: 'member_collection',
      metadata: { memberCount: plan.markdownCount, memberKeys: plan.items.map(item => item.memberKey) }
    })
  })
  return { memberCount: plan.markdownCount, memberKeys: plan.items.map(item => item.memberKey) }
}

// Kept only for old test/operations callers during the blue/green compatibility
// window. Normal CMS reads never invoke this function after phase 9.
export const synchronizeCmsMembers = async () => {
  const result = await applyCmsMemberMarkdownMigration()
  return result.memberCount
}

export const getMemberProposal = async (proposalId: string) => {
  const [proposal] = await getDatabase().select().from(memberProposals)
    .where(eq(memberProposals.id, proposalId)).limit(1)
  return proposal || null
}

export const listMemberProposals = async (memberId: string) => getDatabase().select()
  .from(memberProposals).where(eq(memberProposals.memberId, memberId))
  .orderBy(asc(memberProposals.createdAt))

export const applyMemberProposal = async (
  proposalId: string,
  expectedVersion: number,
  confirmation: string,
  actorUserId: string
) => {
  if (confirmation !== 'APPLY_MEMBER_PROPOSAL') throw new Error('MEMBER_PROPOSAL_CONFIRMATION_INVALID')
  let memberId = ''
  await getDatabase().transaction(async (tx) => {
    const [proposal] = await tx.select().from(memberProposals)
      .where(eq(memberProposals.id, proposalId)).limit(1).for('update')
    if (!proposal) throw new Error('MEMBER_PROPOSAL_NOT_FOUND')
    if (proposal.status === 'applied') { memberId = proposal.memberId; return }
    if (proposal.status !== 'pending') throw new Error('MEMBER_PROPOSAL_NOT_PENDING')
    const [current] = await tx.select().from(members)
      .where(eq(members.id, proposal.memberId)).limit(1).for('update')
    if (!current) throw new Error('MEMBER_NOT_FOUND')
    if (current.version !== expectedVersion || current.currentRevisionId !== proposal.currentRevisionId) {
      throw new CmsMemberVersionConflictError()
    }
    const profile = proposal.action === 'update'
      ? profileFromRecord(proposal.proposedProfile || {})
      : profileFromMemberRow(current)
    if (profile.memberKey !== current.memberKey) throw new Error('MEMBER_KEY_IMMUTABLE')
    const revisionNumber = (await tx.select({ value: sql<number>`coalesce(max(${memberRevisions.revisionNumber}), 0)::int` })
      .from(memberRevisions).where(eq(memberRevisions.memberId, current.id)))[0]!.value + 1
    const result = await appendRevisionAndOutbox(tx, {
      memberId: current.id, revisionNumber, profile,
      sourceKind: proposal.action === 'delete' ? 'delete' : 'proposal_apply',
      actorUserId, sourceProposalId: proposal.id,
      operation: proposal.action === 'delete' ? 'delete' : 'member_update'
    })
    await tx.update(members).set({
      ...memberValues(profile), currentRevisionId: result.revisionId,
      version: current.version + 1,
      deletedAt: proposal.action === 'delete' ? new Date() : null,
      deletedByUserId: proposal.action === 'delete' ? actorUserId : null,
      updatedAt: new Date()
    }).where(and(eq(members.id, current.id), eq(members.version, current.version)))
    await tx.update(memberProposals).set({
      status: 'applied', appliedByUserId: actorUserId,
      appliedRevisionId: result.revisionId, resolvedAt: new Date()
    }).where(eq(memberProposals.id, proposal.id))
    await tx.insert(auditLogs).values({
      actorUserId, action: 'member.proposal.apply', targetType: 'member_proposal', targetId: proposal.id,
      metadata: { memberId: current.id, proposalAction: proposal.action,
        previousRevisionId: current.currentRevisionId, revisionId: result.revisionId, exportJobId: result.jobId }
    })
    memberId = current.id
  })
  return { proposal: await getMemberProposal(proposalId), member: memberId ? await getCmsMember(memberId) : null }
}
