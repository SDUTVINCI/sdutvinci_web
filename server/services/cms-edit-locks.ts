import { randomUUID } from 'node:crypto'
import { and, eq, gt, sql } from 'drizzle-orm'
import type {
  CmsEditLock,
  CmsEditLockResponse,
  CmsEditLockTargetType
} from '../../shared/types/cms-edit-locks'
import { getDatabase } from '../db/client'
import {
  auditLogs,
  drafts,
  editLocks,
  members,
  userMembers,
  users
} from '../db/schema'

const LOCK_TTL_MS = 90_000
export const CMS_EDIT_LOCK_HEARTBEAT_INTERVAL_MS = 20_000

type CmsTransaction = Parameters<
  Parameters<ReturnType<typeof getDatabase>['transaction']>[0]
>[0]

export class CmsEditLockLostError extends Error {
  constructor() {
    super('EDIT_LOCK_LOST')
  }
}

export class CmsEditLockDraftNotFoundError extends Error {
  constructor() {
    super('EDIT_LOCK_DRAFT_NOT_FOUND')
  }
}

interface LockTarget {
  targetType: CmsEditLockTargetType
  targetId: string
  draftOwnerUserId: string
}

const resolveLockTarget = async (
  draftId: string,
  db: ReturnType<typeof getDatabase> | CmsTransaction = getDatabase()
): Promise<LockTarget | null> => {
  const [draft] = await db
    .select({
      articleId: drafts.articleId,
      ownerUserId: drafts.ownerUserId
    })
    .from(drafts)
    .where(eq(drafts.id, draftId))
    .limit(1)
  if (!draft) return null
  return {
    targetType: draft.articleId ? 'article' : 'draft',
    targetId: draft.articleId || draftId,
    draftOwnerUserId: draft.ownerUserId
  }
}

const loadLock = async (
  targetType: CmsEditLockTargetType,
  targetId: string,
  requesterUserId: string
): Promise<CmsEditLock | null> => {
  const [row] = await getDatabase()
    .select({
      targetType: editLocks.targetType,
      targetId: editLocks.targetId,
      holderUserId: editLocks.holderUserId,
      leaseId: editLocks.leaseId,
      account: users.account,
      memberName: members.name,
      acquiredAt: editLocks.acquiredAt,
      heartbeatAt: editLocks.heartbeatAt,
      expiresAt: editLocks.expiresAt
    })
    .from(editLocks)
    .innerJoin(users, eq(editLocks.holderUserId, users.id))
    .leftJoin(userMembers, eq(users.id, userMembers.userId))
    .leftJoin(members, eq(userMembers.memberId, members.id))
    .where(and(
      eq(editLocks.targetType, targetType),
      eq(editLocks.targetId, targetId),
      gt(editLocks.expiresAt, new Date())
    ))
    .limit(1)
  if (!row) return null
  const heldByCurrentUser = row.holderUserId === requesterUserId
  return {
    targetType: row.targetType as CmsEditLockTargetType,
    targetId: row.targetId,
    holder: {
      userId: row.holderUserId,
      account: row.account,
      memberName: row.memberName
    },
    heldByCurrentUser,
    leaseId: heldByCurrentUser ? row.leaseId : null,
    acquiredAt: row.acquiredAt.toISOString(),
    heartbeatAt: row.heartbeatAt.toISOString(),
    expiresAt: row.expiresAt.toISOString()
  }
}

const responseFor = async (
  target: LockTarget,
  requesterUserId: string,
  acquired: boolean
): Promise<CmsEditLockResponse> => {
  const lock = await loadLock(target.targetType, target.targetId, requesterUserId)
  if (!lock) throw new CmsEditLockLostError()
  return {
    acquired,
    lock,
    heartbeatIntervalMs: CMS_EDIT_LOCK_HEARTBEAT_INTERVAL_MS
  }
}

export const getCmsDraftEditLock = async (
  draftId: string,
  requesterUserId: string,
  isAdmin: boolean
): Promise<CmsEditLockResponse | null> => {
  const target = await resolveLockTarget(draftId)
  if (!target) throw new CmsEditLockDraftNotFoundError()
  if (target.draftOwnerUserId !== requesterUserId && !isAdmin) {
    throw new CmsEditLockDraftNotFoundError()
  }
  const lock = await loadLock(target.targetType, target.targetId, requesterUserId)
  return lock
    ? { acquired: lock.heldByCurrentUser, lock, heartbeatIntervalMs: CMS_EDIT_LOCK_HEARTBEAT_INTERVAL_MS }
    : null
}

export const acquireCmsDraftEditLock = async (
  draftId: string,
  requesterUserId: string,
  isAdmin: boolean
): Promise<CmsEditLockResponse> => {
  const target = await getDatabase().transaction(async (tx) => {
    const resolved = await resolveLockTarget(draftId, tx)
    if (!resolved) throw new CmsEditLockDraftNotFoundError()
    if (resolved.draftOwnerUserId !== requesterUserId && !isAdmin) {
      throw new CmsEditLockDraftNotFoundError()
    }

    await tx.execute(sql`
      select pg_advisory_xact_lock(
        hashtextextended(${`${resolved.targetType}:${resolved.targetId}`}, 0)
      )
    `)
    const [active] = await tx
      .select()
      .from(editLocks)
      .where(and(
        eq(editLocks.targetType, resolved.targetType),
        eq(editLocks.targetId, resolved.targetId),
        gt(editLocks.expiresAt, new Date())
      ))
      .limit(1)
    if (active && active.holderUserId !== requesterUserId) {
      return { resolved, acquired: false }
    }

    const now = new Date()
    const values = {
      holderUserId: requesterUserId,
      leaseId: randomUUID(),
      acquiredAt: now,
      heartbeatAt: now,
      expiresAt: new Date(now.getTime() + LOCK_TTL_MS)
    }
    await tx.insert(editLocks).values({
      targetType: resolved.targetType,
      targetId: resolved.targetId,
      ...values
    }).onConflictDoUpdate({
      target: [editLocks.targetType, editLocks.targetId],
      set: values
    })
    return { resolved, acquired: true }
  })
  return responseFor(target.resolved, requesterUserId, target.acquired)
}

export const heartbeatCmsDraftEditLock = async (
  draftId: string,
  requesterUserId: string,
  leaseId: string
): Promise<CmsEditLockResponse> => {
  const target = await resolveLockTarget(draftId)
  if (!target) throw new CmsEditLockDraftNotFoundError()
  const now = new Date()
  const [updated] = await getDatabase()
    .update(editLocks)
    .set({
      heartbeatAt: now,
      expiresAt: new Date(now.getTime() + LOCK_TTL_MS)
    })
    .where(and(
      eq(editLocks.targetType, target.targetType),
      eq(editLocks.targetId, target.targetId),
      eq(editLocks.holderUserId, requesterUserId),
      eq(editLocks.leaseId, leaseId),
      gt(editLocks.expiresAt, now)
    ))
    .returning({ id: editLocks.id })
  if (!updated) throw new CmsEditLockLostError()
  return responseFor(target, requesterUserId, true)
}

export const releaseCmsDraftEditLock = async (
  draftId: string,
  requesterUserId: string,
  leaseId: string
) => {
  const target = await resolveLockTarget(draftId)
  if (!target) return false
  const removed = await getDatabase()
    .delete(editLocks)
    .where(and(
      eq(editLocks.targetType, target.targetType),
      eq(editLocks.targetId, target.targetId),
      eq(editLocks.holderUserId, requesterUserId),
      eq(editLocks.leaseId, leaseId)
    ))
    .returning({ id: editLocks.id })
  return removed.length > 0
}

export const takeoverCmsDraftEditLock = async (
  draftId: string,
  adminUserId: string,
  reason: string | undefined
): Promise<CmsEditLockResponse> => {
  const target = await getDatabase().transaction(async (tx) => {
    const resolved = await resolveLockTarget(draftId, tx)
    if (!resolved) throw new CmsEditLockDraftNotFoundError()
    await tx.execute(sql`
      select pg_advisory_xact_lock(
        hashtextextended(${`${resolved.targetType}:${resolved.targetId}`}, 0)
      )
    `)
    const [previous] = await tx
      .select()
      .from(editLocks)
      .where(and(
        eq(editLocks.targetType, resolved.targetType),
        eq(editLocks.targetId, resolved.targetId),
        gt(editLocks.expiresAt, new Date())
      ))
      .limit(1)

    const now = new Date()
    const values = {
      holderUserId: adminUserId,
      leaseId: randomUUID(),
      acquiredAt: now,
      heartbeatAt: now,
      expiresAt: new Date(now.getTime() + LOCK_TTL_MS)
    }
    await tx.insert(editLocks).values({
      targetType: resolved.targetType,
      targetId: resolved.targetId,
      ...values
    }).onConflictDoUpdate({
      target: [editLocks.targetType, editLocks.targetId],
      set: values
    })
    await tx.insert(auditLogs).values({
      actorUserId: adminUserId,
      action: 'edit_lock.takeover',
      targetType: resolved.targetType,
      targetId: resolved.targetId,
      metadata: {
        draftId,
        previousHolderUserId: previous?.holderUserId || null,
        newHolderUserId: adminUserId,
        reason: reason || null
      }
    })
    return resolved
  })
  return responseFor(target, adminUserId, true)
}

export const assertCmsDraftEditLease = async (
  tx: CmsTransaction,
  draftId: string,
  requesterUserId: string,
  leaseId: string
) => {
  const result = await tx.execute(sql`
    select l.id
    from drafts d
    inner join edit_locks l
      on l.target_type = case when d.article_id is null then 'draft' else 'article' end
      and l.target_id = coalesce(d.article_id, d.id)
    where d.id = ${draftId}
      and l.holder_user_id = ${requesterUserId}
      and l.lease_id = ${leaseId}
      and l.expires_at > now()
    for update of l
  `)
  if (result.rowCount !== 1) throw new CmsEditLockLostError()
}

export const releaseCmsDraftEditLeaseInTransaction = async (
  tx: CmsTransaction,
  draftId: string,
  requesterUserId: string,
  leaseId: string
) => {
  await tx.execute(sql`
    delete from edit_locks l
    using drafts d
    where d.id = ${draftId}
      and l.target_type = case when d.article_id is null then 'draft' else 'article' end
      and l.target_id = coalesce(d.article_id, d.id)
      and l.holder_user_id = ${requesterUserId}
      and l.lease_id = ${leaseId}
  `)
}
