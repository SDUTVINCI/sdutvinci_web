import { eq, sql } from 'drizzle-orm'
import { getDatabase } from '../db/client'
import {
  auditLogs,
  contentReconciliationRequests
} from '../db/schema'
import { describeCmsFailure } from '../utils/cms-sensitive-data'
import { runContentReconciliation } from './content-reconciliation'

const errorCode = (error: unknown) => {
  if (error instanceof Error && /^[A-Z0-9_]{3,64}$/.test(error.message)) return error.message
  return 'CONTENT_RECONCILIATION_FAILED'
}

export const requestContentReconciliation = async (actorUserId: string) =>
  getDatabase().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('vinci:content-reconciliation-request', 0))`)
    const [active] = await tx.select({
      id: contentReconciliationRequests.id,
      status: contentReconciliationRequests.status
    }).from(contentReconciliationRequests)
      .where(sql`${contentReconciliationRequests.status} in ('pending', 'processing')`)
      .limit(1)
    if (active) return { ...active, created: false }

    const [request] = await tx.insert(contentReconciliationRequests).values({
      requestedByUserId: actorUserId
    }).returning({
      id: contentReconciliationRequests.id,
      status: contentReconciliationRequests.status
    })
    await tx.insert(auditLogs).values({
      actorUserId,
      action: 'content.reconciliation.request',
      targetType: 'content_reconciliation_request',
      targetId: request!.id,
      metadata: { trigger: 'manual' }
    })
    return { ...request!, created: true }
  })

const claimRequest = async () => getDatabase().transaction(async (tx) => {
  await tx.execute(sql`
    update ${contentReconciliationRequests}
    set status = 'failed', error_code = 'CONTENT_RECONCILIATION_REQUEST_EXPIRED',
      error_summary = '全量导出任务执行超时，已由 Worker 回收', completed_at = now()
    where status = 'processing' and started_at < now() - interval '2 hours'
  `)
  const rows = await tx.execute<{ id: string }>(sql`
    select id from ${contentReconciliationRequests}
    where status = 'pending'
    order by created_at
    for update skip locked
    limit 1
  `)
  const request = rows.rows[0]
  if (!request) return null
  await tx.update(contentReconciliationRequests).set({
    status: 'processing',
    startedAt: new Date()
  }).where(eq(contentReconciliationRequests.id, request.id))
  return request
})

export const runNextRequestedContentReconciliation = async () => {
  const request = await claimRequest()
  if (!request) return null
  try {
    const result = await runContentReconciliation('manual', request.id)
    await getDatabase().update(contentReconciliationRequests).set({
      status: result.state,
      completedAt: new Date(),
      errorCode: result.state === 'busy' ? 'CONTENT_EXPORT_WORKER_BUSY' : null,
      errorSummary: result.state === 'busy' ? '增量导出或其他全量对账正在运行' : null
    }).where(eq(contentReconciliationRequests.id, request.id))
    return { requestId: request.id, ...result }
  } catch (error) {
    await getDatabase().update(contentReconciliationRequests).set({
      status: 'failed',
      errorCode: errorCode(error),
      errorSummary: describeCmsFailure(error, 1000),
      completedAt: new Date()
    }).where(eq(contentReconciliationRequests.id, request.id))
    return { requestId: request.id, state: 'failed' as const }
  }
}
