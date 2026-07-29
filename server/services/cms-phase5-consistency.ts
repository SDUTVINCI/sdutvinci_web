import { asc } from 'drizzle-orm'
import { getDatabase } from '../db/client'
import {
  articleDeletionEvents,
  articleRevisions,
  articles,
  auditLogs,
  contentExportJobs,
  drafts,
  publishRecords
} from '../db/schema'

export interface CmsPhase5ConsistencyIssue {
  code: string
  targetType: 'article' | 'revision' | 'draft' | 'publish_record' | 'outbox' | 'deletion_event'
  targetId: string
  message: string
}

export interface CmsPhase5ConsistencyReport {
  mode: 'read_only'
  generatedAt: string
  counts: {
    articles: number
    revisions: number
    databaseOperations: number
    outboxJobs: number
    deletionEvents: number
  }
  issueCount: number
  issues: CmsPhase5ConsistencyIssue[]
}

const metadataString = (value: Record<string, unknown>, key: string) =>
  typeof value[key] === 'string' ? value[key] as string : null

export const checkCmsPhase5Consistency =
  async (): Promise<CmsPhase5ConsistencyReport> => {
    const db = getDatabase()
    const [
      articleRows,
      revisionRows,
      draftRows,
      operationRows,
      outboxRows,
      auditRows,
      deletionRows
    ] = await Promise.all([
      db.select().from(articles).orderBy(asc(articles.id)),
      db.select().from(articleRevisions).orderBy(
        asc(articleRevisions.articleId),
        asc(articleRevisions.revisionNumber)
      ),
      db.select().from(drafts),
      db.select().from(publishRecords),
      db.select().from(contentExportJobs),
      db.select().from(auditLogs),
      db.select().from(articleDeletionEvents)
    ])

    const issues: CmsPhase5ConsistencyIssue[] = []
    const articleById = new Map(articleRows.map(row => [row.id, row]))
    const revisionById = new Map(revisionRows.map(row => [row.id, row]))
    const operationById = new Map(operationRows.map(row => [row.id, row]))
    const outboxById = new Map(outboxRows.map(row => [row.id, row]))
    const outboxByRevision = new Map<string, typeof outboxRows>()
    for (const job of outboxRows) {
      if (!job.revisionId) continue
      const jobs = outboxByRevision.get(job.revisionId) || []
      jobs.push(job)
      outboxByRevision.set(job.revisionId, jobs)
    }
    const auditKeys = new Set(auditRows.map(row => {
      const revisionId = metadataString(row.metadata, 'revisionId')
      return `${row.action}:${row.targetId || ''}:${revisionId || ''}`
    }))
    const add = (
      code: string,
      targetType: CmsPhase5ConsistencyIssue['targetType'],
      targetId: string,
      message: string
    ) => issues.push({ code, targetType, targetId, message })

    for (const article of articleRows) {
      const current = article.currentRevisionId
        ? revisionById.get(article.currentRevisionId)
        : null
      if (article.isPresent === 'true' && !article.deletedAt && !current) {
        add(
          'ACTIVE_ARTICLE_WITHOUT_CURRENT_REVISION',
          'article',
          article.id,
          '有效正式文章没有可用的 currentRevisionId'
        )
        continue
      }
      if (current && current.articleId !== article.id) {
        add(
          'CURRENT_REVISION_WRONG_ARTICLE',
          'article',
          article.id,
          'currentRevisionId 指向其他文章'
        )
      }
      if (
        current
        && (
          article.contentHash !== current.contentHash
          || JSON.stringify(article.frontmatter) !== JSON.stringify(current.frontmatter)
        )
      ) {
        add(
          'ARTICLE_PROJECTION_MISMATCH',
          'article',
          article.id,
          '文章当前投影与 current Revision 不一致'
        )
      }
    }

    const revisionsByArticle = new Map<string, typeof revisionRows>()
    for (const revision of revisionRows) {
      const rows = revisionsByArticle.get(revision.articleId) || []
      rows.push(revision)
      revisionsByArticle.set(revision.articleId, rows)
    }
    for (const [articleId, revisions] of revisionsByArticle) {
      revisions.forEach((revision, index) => {
        if (revision.revisionNumber !== index + 1) {
          add(
            'REVISION_SEQUENCE_GAP',
            'revision',
            revision.id,
            `文章 ${articleId} 的 Revision 序号不连续`
          )
        }
      })
    }

    const databaseOperations = operationRows.filter(
      row => row.metadata.authority === 'database'
    )
    for (const operation of databaseOperations) {
      const revisionId = metadataString(operation.metadata, 'revisionId')
      const exportJobId = metadataString(operation.metadata, 'exportJobId')
      const revision = revisionId ? revisionById.get(revisionId) : null
      const job = exportJobId ? outboxById.get(exportJobId) : null
      if (operation.status !== 'succeeded' || !operation.completedAt) {
        add(
          'DATABASE_OPERATION_NOT_SUCCEEDED',
          'publish_record',
          operation.id,
          'DB-first 发布/恢复记录不是已成功状态'
        )
      }
      if (!revision || revision.sourceOperationId !== operation.id) {
        add(
          'DATABASE_OPERATION_REVISION_MISSING',
          'publish_record',
          operation.id,
          'DB-first 发布/恢复记录缺少对应 Revision'
        )
      }
      if (
        !job
        || !revision
        || job.revisionId !== revision.id
        || job.targetId !== operation.articleId
      ) {
        add(
          'DATABASE_OPERATION_OUTBOX_MISSING',
          'publish_record',
          operation.id,
          'DB-first 发布/恢复记录缺少对应 Outbox'
        )
      }
      if (
        revision
        && !auditKeys.has(
          `article.${operation.operation}:${operation.articleId || ''}:${revision.id}`
        )
      ) {
        add(
          'DATABASE_OPERATION_AUDIT_MISSING',
          'publish_record',
          operation.id,
          'DB-first 发布/恢复记录缺少对应审计日志'
        )
      }
    }

    for (const revision of revisionRows) {
      if (
        revision.gitCommitHash === null
        && ['publish', 'restore'].includes(revision.sourceKind)
      ) {
        const operation = revision.sourceOperationId
          ? operationById.get(revision.sourceOperationId)
          : null
        if (!operation || operation.metadata.authority !== 'database') {
          add(
            'DATABASE_REVISION_OPERATION_MISSING',
            'revision',
            revision.id,
            '无 Git Commit 的正式 Revision 缺少 DB-first 操作记录'
          )
        }
        if (!(outboxByRevision.get(revision.id) || []).length) {
          add(
            'DATABASE_REVISION_OUTBOX_MISSING',
            'revision',
            revision.id,
            '无 Git Commit 的正式 Revision 缺少 Outbox'
          )
        }
      }
    }

    for (const draft of draftRows) {
      if (!draft.baseRevisionId) continue
      const revision = revisionById.get(draft.baseRevisionId)
      if (!revision || (draft.articleId && revision.articleId !== draft.articleId)) {
        add(
          'DRAFT_BASE_REVISION_INVALID',
          'draft',
          draft.id,
          '草稿 baseRevisionId 不属于其正式文章'
        )
      }
    }

    for (const job of outboxRows) {
      if (job.targetType !== 'article' || !job.revisionId) continue
      const revision = revisionById.get(job.revisionId)
      if (!revision || revision.articleId !== job.targetId) {
        add(
          'OUTBOX_REVISION_TARGET_MISMATCH',
          'outbox',
          job.id,
          '文章 Outbox 的 Revision 与 targetId 不一致'
        )
      }
    }

    for (const event of deletionRows) {
      if (event.metadata.authority !== 'database') continue
      const job = event.exportJobId ? outboxById.get(event.exportJobId) : null
      const source = event.sourceRevisionId
        ? revisionById.get(event.sourceRevisionId)
        : null
      const result = event.resultRevisionId
        ? revisionById.get(event.resultRevisionId)
        : null
      if (
        !job
        || !source
        || !result
        || source.articleId !== event.articleId
        || result.articleId !== event.articleId
      ) {
        add(
          'DATABASE_DELETION_ATOMIC_LINK_MISSING',
          'deletion_event',
          event.id,
          'DB-first 删除/恢复事件缺少 Revision 或 Outbox 原子关联'
        )
      }
    }

    return {
      mode: 'read_only',
      generatedAt: new Date().toISOString(),
      counts: {
        articles: articleRows.length,
        revisions: revisionRows.length,
        databaseOperations: databaseOperations.length,
        outboxJobs: outboxRows.length,
        deletionEvents: deletionRows.length
      },
      issueCount: issues.length,
      issues
    }
  }
