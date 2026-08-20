import { diffLines } from 'diff'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type {
  CmsDraftStatus
} from '../../shared/types/cms-drafts'
import type {
  CmsDiffPart,
  CmsReviewAction,
  CmsReviewComparison,
  CmsReviewDetail,
  CmsReviewEvent,
  CmsReviewSummary
} from '../../shared/types/cms-reviews'
import { getDatabase } from '../db/client'
import {
  drafts,
  members,
  reviewEvents,
  userMembers,
  users
} from '../db/schema'
import { getCmsArticle } from './cms-articles'
import { getCmsDraftForReview } from './cms-drafts'
import { isCmsDatabaseAuthorityEnabled } from '../utils/cms-v2-flags'
import { normalizeWikiDocumentTags } from '../../shared/utils/wiki-tags'
import {
  assertCmsDraftEditLease,
  releaseCmsDraftEditLeaseInTransaction
} from './cms-edit-locks'

type CmsTransaction = Parameters<
  Parameters<ReturnType<typeof getDatabase>['transaction']>[0]
>[0]

export class CmsReviewNotFoundError extends Error {
  constructor() {
    super('REVIEW_NOT_FOUND')
  }
}

export class CmsReviewStateError extends Error {
  constructor() {
    super('REVIEW_STATE_INVALID')
  }
}

export class CmsPublishedVersionConflictError extends Error {
  currentContentHash: string | null
  currentRevisionId: string | null

  constructor(currentContentHash: string | null, currentRevisionId: string | null = null) {
    super('PUBLISHED_VERSION_CONFLICT')
    this.currentContentHash = currentContentHash
    this.currentRevisionId = currentRevisionId
  }
}

const comparisonForDraft = async (draftId: string): Promise<CmsReviewComparison> => {
  const draft = await getCmsDraftForReview(draftId)
  if (!draft) throw new CmsReviewNotFoundError()
  const formalArticle = draft.articleId
    ? await getCmsArticle(draft.articleId)
    : null
  if (draft.articleId && !formalArticle) {
    throw new CmsPublishedVersionConflictError(null, null)
  }
  const formalAuthorKeys = Array.isArray(formalArticle?.frontmatter.authors)
    ? formalArticle.frontmatter.authors.filter(value => typeof value === 'string') as string[]
    : []
  const formal = formalArticle
    ? {
        title: formalArticle.title,
        description: typeof formalArticle.frontmatter.description === 'string'
          ? formalArticle.frontmatter.description
          : '',
        authorKeys: formalAuthorKeys,
        wikiTags: draft.wikiContentType === 'document'
          ? normalizeWikiDocumentTags(formalArticle.frontmatter.tags)
          : [],
        body: formalArticle.body
      }
    : null
  const draftValue = {
    title: draft.title,
    description: draft.description,
    authorKeys: draft.authors.map(author => author.memberKey),
    wikiTags: draft.wikiTags,
    body: draft.body
  }
  const databaseAuthority = isCmsDatabaseAuthorityEnabled()
  const hasVersionConflict = Boolean(draft.articleId && (
    databaseAuthority
      ? (
          !draft.baseRevisionId
          || draft.baseRevisionId !== formalArticle?.currentRevision?.id
        )
      : draft.baseContentHash !== formalArticle?.contentHash
  ))
  const bodyDiff: CmsDiffPart[] = diffLines(formal?.body || '', draft.body).map(part => ({
    type: part.added ? 'added' : part.removed ? 'removed' : 'same',
    value: part.value
  }))
  return {
    baseContentHash: draft.baseContentHash,
    currentContentHash: formalArticle?.contentHash || null,
    baseRevisionId: draft.baseRevisionId,
    currentRevisionId: formalArticle?.currentRevision?.id || null,
    hasVersionConflict,
    formal,
    draft: draftValue,
    bodyDiff
  }
}

const insertReviewEvent = async (
  tx: CmsTransaction,
  input: {
    draftId: string
    actorUserId: string
    action: CmsReviewAction
    fromStatus: CmsDraftStatus
    toStatus: CmsDraftStatus
    reason?: string
    metadata?: Record<string, unknown>
  }
) => {
  await tx.insert(reviewEvents).values({
    draftId: input.draftId,
    actorUserId: input.actorUserId,
    action: input.action,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    reason: input.reason,
    metadata: input.metadata || {}
  })
}

const loadOwner = async (ownerUserId: string) => {
  const [owner] = await getDatabase()
    .select({
      userId: users.id,
      account: users.account,
      memberName: members.name
    })
    .from(users)
    .leftJoin(userMembers, eq(users.id, userMembers.userId))
    .leftJoin(members, eq(userMembers.memberId, members.id))
    .where(eq(users.id, ownerUserId))
    .limit(1)
  if (!owner) throw new CmsReviewNotFoundError()
  return owner
}

export const listCmsReviewsByStatus = async (
  statuses: Array<'pending_review' | 'approved'>
): Promise<CmsReviewSummary[]> => {
  const rows = await getDatabase()
    .select({
      id: drafts.id,
      articleId: drafts.articleId,
      collection: drafts.collection,
      title: drafts.title,
      status: drafts.status,
      version: drafts.version,
      ownerUserId: users.id,
      account: users.account,
      memberName: members.name,
      submittedAt: drafts.updatedAt,
      updatedAt: drafts.updatedAt
    })
    .from(drafts)
    .innerJoin(users, eq(drafts.ownerUserId, users.id))
    .leftJoin(userMembers, eq(users.id, userMembers.userId))
    .leftJoin(members, eq(userMembers.memberId, members.id))
    .where(and(inArray(drafts.status, statuses), isNull(drafts.deletedAt)))
    .orderBy(asc(drafts.updatedAt))
  return rows.map(row => ({
    id: row.id,
    articleId: row.articleId,
    collection: row.collection as CmsReviewSummary['collection'],
    title: row.title,
    status: row.status as CmsDraftStatus,
    version: row.version,
    owner: {
      userId: row.ownerUserId,
      account: row.account,
      memberName: row.memberName
    },
    submittedAt: row.submittedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }))
}

export const listCmsPendingReviews = async () =>
  listCmsReviewsByStatus(['pending_review'])

export const listCmsApprovedReviews = async () =>
  listCmsReviewsByStatus(['approved'])

export const getCmsReviewDetail = async (draftId: string): Promise<CmsReviewDetail> => {
  const draft = await getCmsDraftForReview(draftId)
  if (!draft) throw new CmsReviewNotFoundError()
  const owner = await loadOwner(draft.ownerUserId)
  return {
    draft,
    owner,
    events: await listCmsDraftReviewEvents(draftId),
    comparison: await comparisonForDraft(draftId)
  }
}

export const listCmsDraftReviewEvents = async (
  draftId: string
): Promise<CmsReviewEvent[]> => {
  const rows = await getDatabase()
    .select({
      id: reviewEvents.id,
      action: reviewEvents.action,
      fromStatus: reviewEvents.fromStatus,
      toStatus: reviewEvents.toStatus,
      reason: reviewEvents.reason,
      metadata: reviewEvents.metadata,
      actorUserId: reviewEvents.actorUserId,
      account: users.account,
      memberName: members.name,
      createdAt: reviewEvents.createdAt
    })
    .from(reviewEvents)
    .leftJoin(users, eq(reviewEvents.actorUserId, users.id))
    .leftJoin(userMembers, eq(users.id, userMembers.userId))
    .leftJoin(members, eq(userMembers.memberId, members.id))
    .where(eq(reviewEvents.draftId, draftId))
    .orderBy(desc(reviewEvents.createdAt))
  return rows.map(row => ({
    id: row.id,
    action: row.action as CmsReviewAction,
    fromStatus: row.fromStatus as CmsDraftStatus,
    toStatus: row.toStatus as CmsDraftStatus,
    reason: row.reason,
    metadata: row.metadata,
    actor: {
      userId: row.actorUserId,
      account: row.account,
      memberName: row.memberName
    },
    createdAt: row.createdAt.toISOString()
  }))
}

const ensureCurrentBase = async (draftId: string) => {
  const comparison = await comparisonForDraft(draftId)
  if (comparison.hasVersionConflict) {
    throw new CmsPublishedVersionConflictError(
      comparison.currentContentHash,
      comparison.currentRevisionId
    )
  }
  return comparison
}

const ensureDraftAccess = async (
  draftId: string,
  requesterUserId: string,
  allowAdmin = false
) => {
  const [row] = await getDatabase()
    .select({ ownerUserId: drafts.ownerUserId })
    .from(drafts)
    .where(and(eq(drafts.id, draftId), isNull(drafts.deletedAt)))
    .limit(1)
  if (!row || (!allowAdmin && row.ownerUserId !== requesterUserId)) {
    throw new CmsReviewNotFoundError()
  }
}

export const submitCmsDraftForReview = async (
  draftId: string,
  ownerUserId: string,
  input: { version: number, lockLeaseId: string }
) => {
  await ensureDraftAccess(draftId, ownerUserId)
  const comparison = await ensureCurrentBase(draftId)
  const [updated] = await getDatabase().transaction(async (tx) => {
    await assertCmsDraftEditLease(tx, draftId, ownerUserId, input.lockLeaseId)
    const result = await tx
      .update(drafts)
      .set({
        status: 'pending_review',
        version: sql`${drafts.version} + 1`,
        updatedAt: new Date()
      })
      .where(and(
        eq(drafts.id, draftId),
        eq(drafts.ownerUserId, ownerUserId),
        eq(drafts.status, 'draft'),
        eq(drafts.version, input.version)
      ))
      .returning()
    const row = result[0]
    if (!row) throw new CmsReviewStateError()
    await insertReviewEvent(tx, {
      draftId,
      actorUserId: ownerUserId,
      action: 'submitted',
      fromStatus: 'draft',
      toStatus: 'pending_review',
      metadata: {
        baseContentHash: row.baseContentHash,
        currentContentHash: comparison.currentContentHash,
        baseRevisionId: row.baseRevisionId,
        currentRevisionId: comparison.currentRevisionId
      }
    })
    await releaseCmsDraftEditLeaseInTransaction(
      tx,
      draftId,
      ownerUserId,
      input.lockLeaseId
    )
    return result
  })
  return getCmsDraftForReview(updated!.id)
}

export const withdrawCmsDraftReview = async (
  draftId: string,
  ownerUserId: string,
  version: number
) => {
  const [updated] = await getDatabase().transaction(async (tx) => {
    const result = await tx
      .update(drafts)
      .set({
        status: 'withdrawn',
        version: sql`${drafts.version} + 1`,
        updatedAt: new Date()
      })
      .where(and(
        eq(drafts.id, draftId),
        eq(drafts.ownerUserId, ownerUserId),
        eq(drafts.status, 'pending_review'),
        eq(drafts.version, version)
      ))
      .returning()
    if (!result[0]) throw new CmsReviewStateError()
    await insertReviewEvent(tx, {
      draftId,
      actorUserId: ownerUserId,
      action: 'withdrawn',
      fromStatus: 'pending_review',
      toStatus: 'withdrawn'
    })
    return result
  })
  return getCmsDraftForReview(updated!.id)
}

export const reopenCmsDraft = async (
  draftId: string,
  requesterUserId: string,
  input: { version: number, lockLeaseId: string },
  allowAdmin = false
) => {
  const [updated] = await getDatabase().transaction(async (tx) => {
    await assertCmsDraftEditLease(tx, draftId, requesterUserId, input.lockLeaseId)
    const ownerCondition = allowAdmin
      ? eq(drafts.id, draftId)
      : and(eq(drafts.id, draftId), eq(drafts.ownerUserId, requesterUserId))
    const [current] = await tx
      .select({ status: drafts.status })
      .from(drafts)
      .where(ownerCondition)
      .limit(1)
    if (!current || !['rejected', 'withdrawn'].includes(current.status)) {
      throw new CmsReviewStateError()
    }
    const conditions = [
      eq(drafts.id, draftId),
      eq(drafts.status, current.status),
      eq(drafts.version, input.version)
    ]
    if (!allowAdmin) conditions.push(eq(drafts.ownerUserId, requesterUserId))
    const result = await tx
      .update(drafts)
      .set({
        status: 'draft',
        version: sql`${drafts.version} + 1`,
        updatedAt: new Date()
      })
      .where(and(...conditions))
      .returning()
    const row = result[0]
    if (!row) throw new CmsReviewStateError()
    await insertReviewEvent(tx, {
      draftId,
      actorUserId: requesterUserId,
      action: 'reopened',
      fromStatus: current.status as CmsDraftStatus,
      toStatus: 'draft'
    })
    return result
  })
  return getCmsDraftForReview(updated!.id)
}

export const resyncCmsDraftBase = async (
  draftId: string,
  requesterUserId: string,
  input: {
    version: number
    lockLeaseId: string
    expectedCurrentContentHash?: string
    expectedCurrentRevisionId?: string
  },
  allowAdmin = false
) => {
  await ensureDraftAccess(draftId, requesterUserId, allowAdmin)
  const comparison = await comparisonForDraft(draftId)
  const databaseAuthority = isCmsDatabaseAuthorityEnabled()
  if (databaseAuthority
    ? (
        !comparison.currentRevisionId
        || comparison.currentRevisionId !== input.expectedCurrentRevisionId
      )
    : (
        !comparison.currentContentHash
        || comparison.currentContentHash !== input.expectedCurrentContentHash
      )
  ) {
    throw new CmsPublishedVersionConflictError(
      comparison.currentContentHash,
      comparison.currentRevisionId
    )
  }
  const [updated] = await getDatabase().transaction(async (tx) => {
    await assertCmsDraftEditLease(tx, draftId, requesterUserId, input.lockLeaseId)
    const conditions = [
      eq(drafts.id, draftId),
      eq(drafts.status, 'draft'),
      eq(drafts.version, input.version)
    ]
    if (!allowAdmin) conditions.push(eq(drafts.ownerUserId, requesterUserId))
    const result = await tx
      .update(drafts)
      .set({
        baseContentHash: comparison.currentContentHash,
        baseRevisionId: comparison.currentRevisionId,
        version: sql`${drafts.version} + 1`,
        updatedAt: new Date()
      })
      .where(and(...conditions))
      .returning()
    const row = result[0]
    if (!row) throw new CmsReviewStateError()
    await insertReviewEvent(tx, {
      draftId,
      actorUserId: requesterUserId,
      action: 'resynced',
      fromStatus: 'draft',
      toStatus: 'draft',
      metadata: {
        previousBaseContentHash: comparison.baseContentHash,
        currentContentHash: comparison.currentContentHash,
        previousBaseRevisionId: comparison.baseRevisionId,
        currentRevisionId: comparison.currentRevisionId
      }
    })
    return result
  })
  return getCmsDraftForReview(updated!.id)
}

export const rejectCmsDraftReview = async (
  draftId: string,
  adminUserId: string,
  input: { version: number, reason: string }
) => {
  const [updated] = await getDatabase().transaction(async (tx) => {
    const result = await tx
      .update(drafts)
      .set({
        status: 'rejected',
        version: sql`${drafts.version} + 1`,
        updatedAt: new Date()
      })
      .where(and(
        eq(drafts.id, draftId),
        eq(drafts.status, 'pending_review'),
        eq(drafts.version, input.version)
      ))
      .returning()
    if (!result[0]) throw new CmsReviewStateError()
    await insertReviewEvent(tx, {
      draftId,
      actorUserId: adminUserId,
      action: 'rejected',
      fromStatus: 'pending_review',
      toStatus: 'rejected',
      reason: input.reason
    })
    return result
  })
  return getCmsDraftForReview(updated!.id)
}

export const approveCmsDraftReview = async (
  draftId: string,
  adminUserId: string,
  version: number
) => {
  const comparison = await ensureCurrentBase(draftId)
  const [updated] = await getDatabase().transaction(async (tx) => {
    const result = await tx
      .update(drafts)
      .set({
        status: 'approved',
        version: sql`${drafts.version} + 1`,
        updatedAt: new Date()
      })
      .where(and(
        eq(drafts.id, draftId),
        eq(drafts.status, 'pending_review'),
        eq(drafts.version, version)
      ))
      .returning()
    if (!result[0]) throw new CmsReviewStateError()
    await insertReviewEvent(tx, {
      draftId,
      actorUserId: adminUserId,
      action: 'approved',
      fromStatus: 'pending_review',
      toStatus: 'approved',
      metadata: {
        baseContentHash: result[0].baseContentHash,
        currentContentHash: comparison.currentContentHash,
        baseRevisionId: result[0].baseRevisionId,
        currentRevisionId: comparison.currentRevisionId
      }
    })
    return result
  })
  return getCmsDraftForReview(updated!.id)
}

export const getCmsDraftComparison = comparisonForDraft
