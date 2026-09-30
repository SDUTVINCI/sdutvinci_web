import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { CmsMember, CmsMemberInput } from '../../shared/types/cms-members'
import { getDatabase } from '../db/client'
import { getActiveMemberAccountLink } from './member-account-links'
import {
  auditLogs,
  accountRegistrationApplications,
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
  mergeMemberProfiles,
  profileFromRecord,
  profileRecord,
  normalizeMemberPositions,
  normalizeEditableMemberRoles,
  serializeMemberProfile,
  type MemberProfileSnapshot
} from './member-profile'

export class CmsMemberVersionConflictError extends Error {
  constructor(message = '成员资料已被其他操作更新，请刷新后重试') {
    super(message)
    this.name = 'CmsMemberVersionConflictError'
  }
}

export class CmsMemberKeyConflictError extends Error {
  constructor(message = '稳定 ID 已被其他有效成员或账号占用') {
    super(message)
    this.name = 'CmsMemberKeyConflictError'
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
    .leftJoin(users, and(eq(userMembers.userId, users.id), isNull(users.deletedAt)))
    .orderBy(asc(members.sortOrder), asc(members.memberKey))
  const filters = [
    ...(id ? [eq(members.id, id)] : []),
    ...(!includeDeleted ? [isNull(members.deletedAt)] : [])
  ]
  return filters.length ? query.where(and(...filters)) : query
}

export const listCmsMembers = async (includeDeleted = false): Promise<CmsMember[]> =>
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
  const positions = normalizeEditableMemberRoles({
    positions: input.positions || [],
    seasons: input.seasons || [],
    advisorSeasons: input.advisorSeasons || [],
    grade: input.grade?.trim() || null,
    groupName
  })
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

const canonicalizeHistoricalProfile = (source: MemberProfileSnapshot): MemberProfileSnapshot => {
  const profile = { ...source, positions: [...source.positions], seasons: [...source.seasons],
    advisorSeasons: [...source.advisorSeasons] }
  if (profile.positions.includes('指导老师')) {
    profile.seasons = [...new Set([...profile.seasons, ...profile.advisorSeasons])]
    profile.advisorSeasons = []
    profile.positions = ['指导老师']
    profile.grade = null
    profile.groupName = null
    profile.memberType = '指导老师'
    if (!profile.role?.startsWith('指导老师')) profile.role = '指导老师'
  } else {
    const positions = profile.positions.filter(position => position !== '顾问')
    if (profile.advisorSeasons.length) positions.push('顾问')
    if (positions.join('|') !== profile.positions.join('|')) {
      profile.positions = positions
      profile.role = deriveMemberRole(positions, profile.groupName)
      profile.memberType = deriveMemberType(positions, profile.groupName)
    }
  }
  normalizeEditableMemberRoles(profile)
  return profile
}

export const createCmsMember = async (
  input: CmsMemberInput & { memberKey: string },
  actorUserId: string
) => {
  const memberId = randomUUID()
  const defaultSourcePath = `cms/${input.memberKey.trim().toLowerCase()}.md`
  const [usedDefaultPath] = input.sourcePath ? [] : await getDatabase()
    .select({ id: members.id }).from(members)
    .where(eq(members.sourcePath, defaultSourcePath)).limit(1)
  const sourcePath = input.sourcePath || (usedDefaultPath
    ? `cms/${input.memberKey.trim().toLowerCase()}-${memberId}.md`
    : defaultSourcePath)
  const profile = inputProfile(input, sourcePath)
  await assertMemberProfileOptions(profile)
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
      .where(and(eq(users.account, profile.memberKey), isNull(users.deletedAt))).limit(1)
    if (matchingUser) {
      const [linked] = await tx.insert(userMembers).values({ userId: matchingUser.id, memberId })
        .onConflictDoNothing().returning({ userId: userMembers.userId })
      if (!linked) throw new CmsMemberKeyConflictError('同 ID 账号已关联其他成员，请先在账号管理中处理')
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
  input: Omit<CmsMemberInput, 'directory' | 'sourcePath'> & { expectedVersion?: number },
  actorUserId: string
) => {
  try {
  await getDatabase().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(884021503)`)
    const [current] = await tx.select().from(members).where(eq(members.id, id)).limit(1).for('update')
    if (!current) return
    if (current.deletedAt) throw new Error('MEMBER_NOT_FOUND')
    if (input.expectedVersion !== undefined && current.version !== input.expectedVersion) {
      throw new CmsMemberVersionConflictError()
    }
    const before = profileFromMemberRow(current)
    const next = inputProfile({
      memberKey: input.memberKey ?? current.memberKey,
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
    const samePositions = next.positions.length === before.positions.length
      && next.positions.every(position => before.positions.includes(position))
    if (samePositions && next.groupName === before.groupName) {
      next.role = before.role
      next.memberType = before.memberType
    } else if (before.positions.includes('指导老师') && next.positions.includes('指导老师') && before.role?.startsWith('指导老师，')) {
      next.role = `${next.role}，${before.role.slice('指导老师，'.length)}`
    }
    const changes = memberFieldDiff(before, next)
    if (next.memberKey !== before.memberKey) {
      changes.memberKey = { from: before.memberKey, to: next.memberKey }
      const [otherMember] = await tx.select({ id: members.id }).from(members)
        .where(and(eq(members.memberKey, next.memberKey), isNull(members.deletedAt))).limit(1)
      if (otherMember && otherMember.id !== id) throw new CmsMemberKeyConflictError('该稳定 ID 已被其他有效成员使用')

      const binding = await getActiveMemberAccountLink(tx, id)
      const [targetUser] = await tx.select({ id: users.id }).from(users)
        .where(and(eq(users.account, next.memberKey), isNull(users.deletedAt))).limit(1)
      const [pendingForTarget] = await tx.select({ memberId: accountRegistrationApplications.memberId })
        .from(accountRegistrationApplications).where(and(
          eq(accountRegistrationApplications.account, next.memberKey),
          eq(accountRegistrationApplications.status, 'pending')
        )).limit(1)
      if (pendingForTarget && pendingForTarget.memberId !== id) {
        throw new CmsMemberKeyConflictError('目标 ID 已被其他待审核注册申请占用')
      }
      const [pendingForMember] = await tx.select({ id: accountRegistrationApplications.id })
        .from(accountRegistrationApplications).where(and(
          eq(accountRegistrationApplications.memberId, id),
          eq(accountRegistrationApplications.status, 'pending')
        )).limit(1)
      if (pendingForMember && targetUser) {
        throw new CmsMemberKeyConflictError('该成员已有待审核注册申请，请先处理申请或目标账号')
      }
      if (binding && targetUser && targetUser.id !== binding.userId) {
        throw new CmsMemberKeyConflictError('目标 ID 已有其他账号；请先在账号管理中处理重复账号')
      }
      if (!binding && targetUser) {
        const [targetBinding] = await tx.select({ memberId: userMembers.memberId }).from(userMembers)
          .where(eq(userMembers.userId, targetUser.id)).limit(1)
        if (targetBinding) throw new CmsMemberKeyConflictError('目标账号已关联其他成员')
        await tx.insert(userMembers).values({ userId: targetUser.id, memberId: id })
      } else if (binding && binding.account !== next.memberKey) {
        await tx.update(users).set({ account: next.memberKey, updatedAt: new Date() })
          .where(eq(users.id, binding.userId))
      }
      await tx.update(articleCreditIdentities).set({
        memberId: id,
        version: sql`${articleCreditIdentities.version} + 1`,
        updatedAt: new Date()
      }).where(inArray(articleCreditIdentities.creditKey, [before.memberKey, next.memberKey]))
      await tx.insert(articleCreditIdentities).values({
        creditKey: before.memberKey,
        displayName: before.name,
        memberId: id
      }).onConflictDoNothing()
      await tx.update(accountRegistrationApplications).set({
        account: next.memberKey,
        updatedAt: new Date()
      }).where(and(
        eq(accountRegistrationApplications.memberId, id),
        eq(accountRegistrationApplications.status, 'pending')
      ))
    }
    await assertMemberProfileOptions(next, before)
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
        memberKey: next.memberKey,
        previousRevisionId: current.currentRevisionId,
        revisionId: result.revisionId,
        exportJobId: result.jobId,
        changedFields: Object.keys(changes),
        before: Object.fromEntries(Object.keys(changes).map(key => [key, changes[key]!.from])),
        after: Object.fromEntries(Object.keys(changes).map(key => [key, changes[key]!.to]))
      }
    })
  })
  } catch (error) {
    if (typeof error === 'object' && error && 'code' in error && error.code === '23505') {
      throw new CmsMemberKeyConflictError()
    }
    throw error
  }
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
    const profile = canonicalizeHistoricalProfile({ ...profileFromRecord(target.profile), memberKey: current.memberKey })
    if (current.deletedAt) {
      const [activeCollision] = await tx.select({ id: members.id }).from(members).where(and(
        eq(members.memberKey, current.memberKey), isNull(members.deletedAt)
      )).limit(1)
      if (activeCollision) throw new CmsMemberKeyConflictError('该稳定 ID 已由其他有效成员使用，无法恢复旧档案')
    }
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
    if (current.deletedAt) {
      const existingLink = await getActiveMemberAccountLink(tx, memberId)
      const [matchingUser] = await tx.select({ id: users.id }).from(users).where(and(
        eq(users.account, current.memberKey), isNull(users.deletedAt)
      )).limit(1)
      if (existingLink && existingLink.userId !== matchingUser?.id) {
        throw new CmsMemberKeyConflictError('旧档案已关联其他有效账号，无法恢复')
      }
      if (matchingUser && !existingLink) {
        const [linked] = await tx.insert(userMembers).values({ userId: matchingUser.id, memberId })
          .onConflictDoNothing().returning({ userId: userMembers.userId })
        if (!linked) throw new CmsMemberKeyConflictError('同 ID 账号已关联其他成员，无法恢复旧档案')
      }
      await tx.update(articleCreditIdentities).set({
        memberId,
        version: sql`${articleCreditIdentities.version} + 1`,
        updatedAt: new Date()
      }).where(eq(articleCreditIdentities.creditKey, current.memberKey))
    }
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
      .where(and(isNull(users.deletedAt), isNull(members.deletedAt)))
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

const normalizedCurrentProfile = (row: typeof members.$inferSelect, currentMarkdown: string) => {
  const profile = profileFromMemberRow(row)
  const moveTeacherSeasons = !/^schemaVersion:\s*2\s*$/m.test(currentMarkdown)
    && profile.positions.includes('指导老师') && !profile.grade
    && profile.seasons.length > 0 && profile.advisorSeasons.length === 0
  return { profile: canonicalizeHistoricalProfile(profile), moveTeacherSeasons }
}

export const planCurrentMemberFrontmatterNormalization = async () => {
  const rows = await getDatabase().select().from(members)
    .where(isNull(members.deletedAt)).orderBy(asc(members.memberKey))
  const items = []
  for (const row of rows) {
    if (!row.currentRevisionId) throw new Error(`MEMBER_CURRENT_REVISION_MISSING:${row.memberKey}`)
    const [revision] = await getDatabase().select().from(memberRevisions)
      .where(eq(memberRevisions.id, row.currentRevisionId)).limit(1)
    if (!revision) throw new Error(`MEMBER_CURRENT_REVISION_MISSING:${row.memberKey}`)
    const { profile, moveTeacherSeasons } = normalizedCurrentProfile(row, revision.markdownSource)
    const serialized = serializeMemberProfile(profile)
    if (serialized.sha256 !== revision.contentHash) {
      const [activeProposal] = await getDatabase().select({ id: memberProposals.id }).from(memberProposals)
        .where(and(eq(memberProposals.memberId, row.id), eq(memberProposals.status, 'pending'),
          eq(memberProposals.currentRevisionId, row.currentRevisionId))).limit(1)
      items.push({ memberKey: row.memberKey, moveTeacherSeasons,
        previousHash: revision.contentHash, nextHash: serialized.sha256,
        activeProposalId: activeProposal?.id || null })
    }
  }
  return { scanned: rows.length, changes: items.length, items }
}

export const applyCurrentMemberFrontmatterNormalization = async () => getDatabase().transaction(async (tx) => {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('vinci:v2:member-frontmatter-normalization', 0))`)
  const rows = await tx.select({ id: members.id }).from(members)
    .where(isNull(members.deletedAt)).orderBy(asc(members.memberKey))
  const changed: string[] = []
  for (const item of rows) {
    const [row] = await tx.select().from(members).where(eq(members.id, item.id)).limit(1).for('update')
    if (!row?.currentRevisionId) throw new Error('MEMBER_CURRENT_REVISION_MISSING')
    const [currentRevision] = await tx.select().from(memberRevisions)
      .where(eq(memberRevisions.id, row.currentRevisionId)).limit(1)
    if (!currentRevision) throw new Error('MEMBER_CURRENT_REVISION_MISSING')
    const { profile, moveTeacherSeasons } = normalizedCurrentProfile(row, currentRevision.markdownSource)
    if (serializeMemberProfile(profile).sha256 === currentRevision.contentHash) continue
    const [activeProposal] = await tx.select({ id: memberProposals.id }).from(memberProposals)
      .where(and(eq(memberProposals.memberId, row.id), eq(memberProposals.status, 'pending'),
        eq(memberProposals.currentRevisionId, row.currentRevisionId))).limit(1)
    if (activeProposal) throw new Error(`MEMBER_NORMALIZATION_ACTIVE_PROPOSAL:${row.memberKey}`)
    const revisionNumber = (await tx.select({ value: sql<number>`coalesce(max(${memberRevisions.revisionNumber}), 0)::int` })
      .from(memberRevisions).where(eq(memberRevisions.memberId, row.id)))[0]!.value + 1
    const result = await appendRevisionAndOutbox(tx, {
      memberId: row.id, revisionNumber, profile, sourceKind: 'cms_update', actorUserId: null
    })
    await tx.update(members).set({
      ...memberValues(profile), currentRevisionId: result.revisionId,
      version: row.version + 1, updatedAt: new Date()
    }).where(and(eq(members.id, row.id), eq(members.version, row.version)))
    await tx.insert(auditLogs).values({
      actorUserId: null, action: 'member.frontmatter.normalize', targetType: 'member', targetId: row.id,
      metadata: { previousRevisionId: row.currentRevisionId, revisionId: result.revisionId,
        exportJobId: result.jobId, moveTeacherSeasons }
    })
    changed.push(row.memberKey)
  }
  return { scanned: rows.length, changes: changed.length, memberKeys: changed }
})

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

export const listPendingMemberProposalsForReview = async () => {
  const rows = await getDatabase().select({
    id: memberProposals.id,
    memberId: memberProposals.memberId,
    action: memberProposals.action,
    currentRevisionId: memberProposals.currentRevisionId,
    fieldChanges: memberProposals.fieldChanges,
    createdAt: memberProposals.createdAt,
    memberName: members.name,
    memberKey: members.memberKey,
    avatarUrl: members.avatarUrl,
    memberVersion: members.version,
    memberCurrentRevisionId: members.currentRevisionId,
    deletedAt: members.deletedAt
  }).from(memberProposals).innerJoin(members, eq(memberProposals.memberId, members.id))
    .where(eq(memberProposals.status, 'pending')).orderBy(asc(memberProposals.createdAt))
  return rows.map(row => ({
    id: row.id,
    memberId: row.memberId,
    action: row.action,
    fieldChanges: row.fieldChanges,
    createdAt: row.createdAt.toISOString(),
    member: { name: row.memberName, memberKey: row.memberKey, avatarUrl: row.avatarUrl,
      version: row.memberVersion, deleted: !!row.deletedAt },
    needsMerge: row.currentRevisionId !== row.memberCurrentRevisionId
  }))
}

export const rejectMemberProposal = async (proposalId: string, note: string, actorUserId: string) => {
  await getDatabase().transaction(async (tx) => {
    const [proposal] = await tx.select().from(memberProposals)
      .where(eq(memberProposals.id, proposalId)).limit(1).for('update')
    if (!proposal) throw new Error('MEMBER_PROPOSAL_NOT_FOUND')
    if (proposal.status !== 'pending') throw new Error('MEMBER_PROPOSAL_NOT_PENDING')
    await tx.update(memberProposals).set({
      status: 'rejected', resolvedAt: new Date()
    }).where(eq(memberProposals.id, proposalId))
    await tx.insert(auditLogs).values({
      actorUserId, action: 'member.proposal.reject', targetType: 'member_proposal', targetId: proposalId,
      metadata: { memberId: proposal.memberId, note }
    })
  })
  return getMemberProposal(proposalId)
}

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
    if (current.version !== expectedVersion) throw new CmsMemberVersionConflictError()
    if (current.deletedAt) throw new CmsMemberVersionConflictError('该成员档案已删除，请刷新审核队列')
    const before = profileFromMemberRow(current)
    let profile = proposal.action === 'update'
      ? profileFromRecord(proposal.proposedProfile || {})
      : before
    if (current.currentRevisionId !== proposal.currentRevisionId) {
      if (proposal.action === 'delete') {
        throw new CmsMemberVersionConflictError('删除提案的成员资料已变化，请重新提交提案')
      }
      const [proposalBase] = await tx.select({ profile: memberRevisions.profile }).from(memberRevisions)
        .where(eq(memberRevisions.id, proposal.currentRevisionId)).limit(1)
      if (!proposalBase) throw new CmsMemberVersionConflictError('提案基准版本已不存在，请重新提交提案')
      const merged = mergeMemberProfiles(profileFromRecord(proposalBase.profile), before, profile)
      if (!merged.merged) {
        throw new CmsMemberVersionConflictError(`提案与当前资料的 ${merged.conflicts.join('、')} 字段冲突，请重新提交提案`)
      }
      profile = merged.merged
    }
    if (profile.memberKey !== current.memberKey) throw new Error('MEMBER_KEY_IMMUTABLE')
    if (proposal.action === 'update') profile = canonicalizeHistoricalProfile(profile)
    if (proposal.action === 'update') await assertMemberProfileOptions(profile, before)
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
