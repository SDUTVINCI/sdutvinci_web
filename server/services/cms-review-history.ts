import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { and, count, desc, eq, gte, ilike, lt, or } from 'drizzle-orm'
import { getDatabase } from '../db/client'
import { accountRegistrationApplications, articleRevisions, cmsReviewHistory, draftAuthors, drafts, memberApplications, memberProposals, memberRevisions, members, users, userMembers } from '../db/schema'
import type { ReviewHistoryAction, ReviewHistoryDetail, ReviewHistoryEntry, ReviewHistoryKind } from '../../shared/types/cms-review-history'

type Transaction = Parameters<Parameters<ReturnType<typeof getDatabase>['transaction']>[0]>[0]
const batches = new AsyncLocalStorage<string>()
export const withReviewHistoryBatch = <T>(operation: () => Promise<T>) => batches.run(randomUUID(), operation)
const fields: Record<string, string> = {
  name: '姓名', memberKey: '成员 ID', isLearner: '新学员', avatarUrl: '头像', image: '头像',
  grade: '年级', groupName: '组别', positions: '身份与职务', seasons: '参加赛季', advisorSeasons: '顾问届次',
  affiliation: '学院 / 单位', teacherDetails: '任职与职称', links: '公开链接', body: '正文 / 简介',
  role: '职务', memberType: '成员类型', title: '标题', description: '摘要', collection: '内容分类', account: '账号', authors: '署名成员 ID', wikiTags: 'Wiki 分类', sortOrder: '排序号'
}
const safeProfile = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(Object.entries(value).filter(([key]) => key in fields))
}
const userLabel = async (tx: Transaction, id: string | null | undefined) => {
  if (!id) return '历史记录未保存'
  const [row] = await tx.select({ account: users.account, name: members.name }).from(users)
    .leftJoin(userMembers, eq(users.id, userMembers.userId)).leftJoin(members, eq(userMembers.memberId, members.id))
    .where(eq(users.id, id)).limit(1)
  return row ? `${row.name || row.account}（@${row.account}）` : '历史记录未保存'
}

export const captureReviewHistorySubject = async (tx: Transaction, kind: ReviewHistoryKind, id: string) => {
  if (kind === 'article') {
    const [draft] = await tx.select().from(drafts).where(eq(drafts.id, id)).limit(1)
    if (!draft) return null
    const [base] = draft.baseRevisionId ? await tx.select().from(articleRevisions).where(eq(articleRevisions.id, draft.baseRevisionId)).limit(1) : []
    const authors = await tx.select({ key: members.memberKey }).from(draftAuthors).innerJoin(members, eq(draftAuthors.memberId, members.id)).where(eq(draftAuthors.draftId, id)).orderBy(draftAuthors.position)
    return { title: draft.title, submitterLabel: await userLabel(tx, draft.ownerUserId), snapshot: {
      operation: draft.proposedAction === 'delete' ? '删除文章' : draft.proposedAction === 'move' ? '移动文章' : draft.collection === 'wiki' ? 'Wiki 内容' : '新闻文章',
      before: base ? { title: base.frontmatter.title, description: base.frontmatter.description, authors: base.frontmatter.authors, wikiTags: base.frontmatter.tags, body: base.body } : {},
      after: { title: draft.title, description: draft.description, collection: draft.collection === 'wiki' ? 'Wiki' : '新闻', authors: authors.map(author => author.key), wikiTags: draft.preservedFrontmatter.tags, body: draft.body }
    } }
  }
  if (kind === 'member_application') {
    const [application] = await tx.select().from(memberApplications).where(eq(memberApplications.id, id)).limit(1)
    if (!application) return null
    return { title: String(application.profile.name || '新成员申请'), submitterLabel: '匿名申请', snapshot: {
      operation: '创建成员档案', before: {}, after: { ...safeProfile(application.profile), avatarUrl: application.avatarPublicUrl }
    } }
  }
  if (kind === 'member_profile') {
    const [proposal] = await tx.select().from(memberProposals).where(eq(memberProposals.id, id)).limit(1)
    if (!proposal) return null
    const [base] = await tx.select().from(memberRevisions).where(eq(memberRevisions.id, proposal.currentRevisionId)).limit(1)
    return { title: String(proposal.proposedProfile?.name || base?.profile.name || '成员资料'), submitterLabel: await userLabel(tx, proposal.createdByUserId), snapshot: {
      operation: proposal.action === 'delete' ? '删除成员档案' : '修改 / 恢复成员资料',
      before: safeProfile(base?.profile), after: proposal.action === 'delete' ? {} : safeProfile(proposal.proposedProfile)
    } }
  }
  const [application] = await tx.select({ account: accountRegistrationApplications.account, name: members.name }).from(accountRegistrationApplications)
    .leftJoin(members, eq(accountRegistrationApplications.memberId, members.id)).where(eq(accountRegistrationApplications.id, id)).limit(1)
  if (!application) return null
  return { title: `${application.name || '成员'} · @${application.account}`, submitterLabel: application.name || '注册申请人', snapshot: {
    operation: '创建账号', before: {}, after: { name: application.name, account: application.account }
  } }
}

export const recordReviewHistory = async (tx: Transaction, input: {
  kind: ReviewHistoryKind, targetId: string, action: ReviewHistoryAction, actorUserId: string,
  sourceKey: string, note?: string | null, snapshot?: Record<string, unknown>
}) => {
  const target = await captureReviewHistorySubject(tx, input.kind, input.targetId)
  if (!target) return
  await tx.insert(cmsReviewHistory).values({
    ...input, title: target.title, actorLabel: await userLabel(tx, input.actorUserId),
    submitterLabel: target.submitterLabel, snapshot: input.snapshot ? { operation: input.snapshot.operation, before: safeProfile(input.snapshot.before), after: safeProfile(input.snapshot.after) } : target.snapshot,
    batchId: batches.getStore() || null
  }).onConflictDoNothing({ target: cmsReviewHistory.sourceKey })
}

export const withReviewHistoryAttempt = async <T>(kind: ReviewHistoryKind, targetId: string, actorUserId: string, operation: () => Promise<T>, intent: 'approve' | 'reject' | 'publish') => {
  try { return await operation() } catch (error) {
    // Failed attempts are recorded after rollback, separately from an actual rejection.
    // Never copy SQL errors, credentials, or exception stacks into the user-facing history.
    try {
      await getDatabase().transaction(tx => recordReviewHistory(tx, {
        kind, targetId, actorUserId, action: 'failed', sourceKey: `failed:${randomUUID()}`,
        note: `本次尝试${({ approve: '通过审核', reject: '驳回申请', publish: '发布文章' })[intent]}未完成，请核对当前状态后重试；本条记录不代表审核驳回。`
      }))
    } catch { /* Retain the original error if the database itself is unavailable. */ }
    throw error
  }
}

const selection = {
  id: cmsReviewHistory.id, kind: cmsReviewHistory.kind, targetId: cmsReviewHistory.targetId,
  title: cmsReviewHistory.title, action: cmsReviewHistory.action, actorUserId: cmsReviewHistory.actorUserId,
  actorLabel: cmsReviewHistory.actorLabel, submitterLabel: cmsReviewHistory.submitterLabel,
  note: cmsReviewHistory.note, batchId: cmsReviewHistory.batchId, legacy: cmsReviewHistory.legacy, createdAt: cmsReviewHistory.createdAt
}
const entry = (row: Omit<typeof cmsReviewHistory.$inferSelect, 'snapshot' | 'sourceKey'>): ReviewHistoryEntry => ({
  id: row.id, kind: row.kind as ReviewHistoryKind, targetId: row.targetId, title: row.title,
  action: row.action as ReviewHistoryAction, actorUserId: row.actorUserId, actorLabel: row.actorLabel,
  submitterLabel: row.submitterLabel, note: row.note, batchId: row.batchId, legacy: row.legacy,
  createdAt: row.createdAt.toISOString()
})
export const listReviewHistory = async (input: {
  page: number, pageSize: number, kind?: ReviewHistoryKind, action?: ReviewHistoryAction,
  reviewer?: string, query?: string, from?: Date, until?: Date, batch?: string
}) => {
  const escaped = input.query?.replace(/[\\%_]/g, '\\$&')
  const where = and(
    input.kind ? eq(cmsReviewHistory.kind, input.kind) : undefined,
    input.action ? eq(cmsReviewHistory.action, input.action) : undefined,
    input.reviewer ? eq(cmsReviewHistory.actorUserId, input.reviewer) : undefined,
    input.batch ? eq(cmsReviewHistory.batchId, input.batch) : undefined,
    input.from ? gte(cmsReviewHistory.createdAt, input.from) : undefined,
    input.until ? lt(cmsReviewHistory.createdAt, input.until) : undefined,
    escaped ? or(ilike(cmsReviewHistory.title, `%${escaped}%`), ilike(cmsReviewHistory.actorLabel, `%${escaped}%`), ilike(cmsReviewHistory.submitterLabel, `%${escaped}%`)) : undefined
  )
  // A single repeatable snapshot keeps pagination counts and rows consistent.
  return getDatabase().transaction(async tx => {
    const [total] = await tx.select({ value: count() }).from(cmsReviewHistory).where(where)
    const rows = await tx.select(selection).from(cmsReviewHistory).where(where)
      .orderBy(desc(cmsReviewHistory.createdAt), desc(cmsReviewHistory.id)).limit(input.pageSize).offset((input.page - 1) * input.pageSize)
    const reviewers = await tx.selectDistinctOn([cmsReviewHistory.actorUserId], { id: cmsReviewHistory.actorUserId, label: cmsReviewHistory.actorLabel })
      .from(cmsReviewHistory).orderBy(cmsReviewHistory.actorUserId, desc(cmsReviewHistory.createdAt), desc(cmsReviewHistory.id))
    return { items: rows.map(entry), total: total!.value, page: input.page, pageSize: input.pageSize,
      reviewers: reviewers.filter((row): row is { id: string, label: string } => row.id !== null).sort((a,b) => a.label.localeCompare(b.label, 'zh-CN')) }
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
}
const display = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '未填写'
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (Array.isArray(value)) return value.length ? value.map(display).join('、') : '无'
  if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${key}：${display(item)}`).join('\n') || '无'
  return String(value)
}
export const getReviewHistoryDetail = async (id: string): Promise<ReviewHistoryDetail | null> => {
  const [row] = await getDatabase().select().from(cmsReviewHistory).where(eq(cmsReviewHistory.id, id)).limit(1)
  if (!row) return null
  const before = safeProfile(row.snapshot.before)
  const after = safeProfile(row.snapshot.after)
  return {
    entry: entry(row), operation: typeof row.snapshot.operation === 'string' ? row.snapshot.operation : null,
    changes: [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
      .map(key => ({ field: fields[key] || key, before: display(before[key]), after: display(after[key]) }))
  }
}
