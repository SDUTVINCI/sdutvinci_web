import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type {
  CmsArticleCreditIdentity,
  CmsArticleCreditIdentityInput,
  PublicArticleCreditIdentity
} from '../../shared/types/article-credit-identities'
import { resolveStaticMediaUrl } from '../../shared/utils/static-media'
import { getDatabase } from '../db/client'
import {
  articleCreditIdentities,
  articleRevisions,
  articles,
  auditLogs,
  contentReconciliationRequests,
  members
} from '../db/schema'
import { memberKeyFromName } from '../utils/member-key'

type CmsTransaction = Parameters<Parameters<ReturnType<typeof getDatabase>['transaction']>[0]>[0]

export class ArticleCreditIdentityConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArticleCreditIdentityConflictError'
  }
}

const normalizeInput = (input: CmsArticleCreditIdentityInput) => ({
  creditKey: (input.creditKey?.trim().toLowerCase() || memberKeyFromName(input.displayName)),
  displayName: input.displayName.trim(),
  memberId: input.memberId || null
})

const assertLinkedMember = async (tx: CmsTransaction, memberId: string | null) => {
  if (!memberId) return
  const [member] = await tx.select({ id: members.id }).from(members).where(and(
    eq(members.id, memberId),
    isNull(members.deletedAt)
  )).limit(1)
  if (!member) throw new ArticleCreditIdentityConflictError('关联的正式成员不存在或已删除')
}

const queueSnapshotReconciliation = async (
  tx: CmsTransaction,
  actorUserId: string,
  creditKey: string
) => {
  await tx.execute(sql`
    select pg_advisory_xact_lock(
      hashtextextended('vinci:content-reconciliation-request', 0)
    )
  `)
  const [active] = await tx.select({ id: contentReconciliationRequests.id })
    .from(contentReconciliationRequests)
    .where(sql`${contentReconciliationRequests.status} in ('pending', 'processing')`)
    .limit(1)
  if (active) return active.id
  const [request] = await tx.insert(contentReconciliationRequests).values({
    requestedByUserId: actorUserId
  }).returning({ id: contentReconciliationRequests.id })
  await tx.insert(auditLogs).values({
    actorUserId,
    action: 'content.reconciliation.request',
    targetType: 'content_reconciliation_request',
    targetId: request!.id,
    metadata: { trigger: 'article_credit_identity', creditKey }
  })
  return request!.id
}

const identitySelection = {
  creditKey: articleCreditIdentities.creditKey,
  displayName: articleCreditIdentities.displayName,
  memberId: articleCreditIdentities.memberId,
  linkedMemberKey: members.memberKey,
  linkedMemberName: members.name,
  linkedMemberAvatarUrl: members.avatarUrl,
  linkedMemberRevisionId: members.currentRevisionId,
  linkedMemberDeletedAt: members.deletedAt,
  version: articleCreditIdentities.version,
  createdAt: articleCreditIdentities.createdAt,
  updatedAt: articleCreditIdentities.updatedAt
}

export const listCmsArticleCreditIdentities = async (): Promise<CmsArticleCreditIdentity[]> => {
  const [rows, currentRevisions] = await Promise.all([
    getDatabase().select(identitySelection)
      .from(articleCreditIdentities)
      .leftJoin(members, eq(articleCreditIdentities.memberId, members.id))
      .orderBy(asc(articleCreditIdentities.creditKey)),
    getDatabase().select({ frontmatter: articleRevisions.frontmatter })
      .from(articles)
      .innerJoin(articleRevisions, eq(articles.currentRevisionId, articleRevisions.id))
      .where(and(eq(articles.isPresent, 'true'), isNull(articles.deletedAt)))
  ])
  const canonicalKeyByReference = new Map<string, string>()
  for (const row of rows) {
    canonicalKeyByReference.set(row.creditKey, row.creditKey)
    canonicalKeyByReference.set(row.displayName, row.creditKey)
  }
  const usage = new Map<string, number>()
  for (const row of currentRevisions) {
    const keys = new Set(
      ['authors', 'contributors'].flatMap((field) => {
        const value = row.frontmatter[field]
        return Array.isArray(value)
          ? value.filter((item): item is string => typeof item === 'string')
          : []
      })
    )
    const usedIdentities = new Set(
      [...keys].map(key => canonicalKeyByReference.get(key)).filter(
        (key): key is string => Boolean(key)
      )
    )
    for (const key of usedIdentities) usage.set(key, (usage.get(key) || 0) + 1)
  }
  return rows.map(row => ({
    creditKey: row.creditKey,
    displayName: row.displayName,
    memberId: row.memberId,
    linkedMemberKey: row.linkedMemberKey,
    linkedMemberName: row.linkedMemberName,
    usageCount: usage.get(row.creditKey) || 0,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }))
}

export const listPublicArticleCreditIdentities = async (
  requestedKeys: readonly string[]
): Promise<PublicArticleCreditIdentity[]> => {
  const keys = [...new Set(requestedKeys.map(key => key.trim()).filter(Boolean))]
  if (!keys.length) return []
  const [memberRows, identityRows] = await Promise.all([
    getDatabase().select({
      memberKey: members.memberKey,
      name: members.name,
      image: members.avatarUrl
    }).from(members).where(and(
      inArray(members.memberKey, keys),
      isNull(members.deletedAt),
      sql`${members.currentRevisionId} is not null`
    )),
    getDatabase().select(identitySelection)
      .from(articleCreditIdentities)
      .leftJoin(members, eq(articleCreditIdentities.memberId, members.id))
      .where(inArray(articleCreditIdentities.creditKey, keys))
  ])
  const resolved = new Map<string, PublicArticleCreditIdentity>()
  for (const row of identityRows) {
    const linked = Boolean(
      row.memberId
      && row.linkedMemberKey
      && row.linkedMemberName
      && row.linkedMemberRevisionId
      && !row.linkedMemberDeletedAt
    )
    resolved.set(row.creditKey, {
      memberKey: row.creditKey,
      name: linked ? row.linkedMemberName! : row.displayName,
      image: linked ? resolveStaticMediaUrl(row.linkedMemberAvatarUrl) || null : null,
      path: linked ? `/team/${encodeURIComponent(row.linkedMemberKey!)}` : null
    })
  }
  for (const member of memberRows) {
    resolved.set(member.memberKey, {
      memberKey: member.memberKey,
      name: member.name,
      image: resolveStaticMediaUrl(member.image) || null,
      path: `/team/${encodeURIComponent(member.memberKey)}`
    })
  }
  return keys.map(key => resolved.get(key)).filter(
    (value): value is PublicArticleCreditIdentity => Boolean(value)
  )
}

export const createArticleCreditIdentity = async (
  input: CmsArticleCreditIdentityInput,
  actorUserId: string
) => {
  const normalized = normalizeInput(input)
  return getDatabase().transaction(async (tx) => {
    await assertLinkedMember(tx, normalized.memberId)
    const [memberCollision] = await tx.select({ id: members.id }).from(members)
      .where(eq(members.memberKey, normalized.creditKey)).limit(1)
    if (memberCollision) {
      throw new ArticleCreditIdentityConflictError('该稳定 ID 已属于正式成员，无需重复登记')
    }
    const [created] = await tx.insert(articleCreditIdentities).values(normalized).returning()
    const reconciliationRequestId = await queueSnapshotReconciliation(
      tx,
      actorUserId,
      normalized.creditKey
    )
    await tx.insert(auditLogs).values({
      actorUserId,
      action: 'article_credit_identity.create',
      targetType: 'article_credit_identity',
      targetId: normalized.creditKey,
      metadata: {
        displayName: normalized.displayName,
        memberId: normalized.memberId,
        reconciliationRequestId
      }
    })
    return created!
  })
}

export const updateArticleCreditIdentity = async (
  creditKey: string,
  input: Omit<CmsArticleCreditIdentityInput, 'creditKey'> & { expectedVersion: number },
  actorUserId: string
) => getDatabase().transaction(async (tx) => {
  const [current] = await tx.select().from(articleCreditIdentities)
    .where(eq(articleCreditIdentities.creditKey, creditKey)).limit(1).for('update')
  if (!current) return null
  if (current.version !== input.expectedVersion) {
    throw new ArticleCreditIdentityConflictError('署名身份已被其他操作更新，请刷新后重试')
  }
  const displayName = input.displayName.trim()
  const memberId = input.memberId || null
  await assertLinkedMember(tx, memberId)
  if (displayName === current.displayName && memberId === current.memberId) return current
  const [updated] = await tx.update(articleCreditIdentities).set({
    displayName,
    memberId,
    version: current.version + 1,
    updatedAt: new Date()
  }).where(and(
    eq(articleCreditIdentities.creditKey, creditKey),
    eq(articleCreditIdentities.version, current.version)
  )).returning()
  if (!updated) {
    throw new ArticleCreditIdentityConflictError('署名身份已被其他操作更新，请刷新后重试')
  }
  const reconciliationRequestId = await queueSnapshotReconciliation(tx, actorUserId, creditKey)
  await tx.insert(auditLogs).values({
    actorUserId,
    action: 'article_credit_identity.update',
    targetType: 'article_credit_identity',
    targetId: creditKey,
    metadata: {
      before: { displayName: current.displayName, memberId: current.memberId },
      after: { displayName, memberId },
      reconciliationRequestId
    }
  })
  return updated
})
