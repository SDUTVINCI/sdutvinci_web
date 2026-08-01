import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import { getDatabase, getDatabasePool } from '../db/client'
import {
  auditLogs,
  contentExportJobs,
  contentExportRuns
} from '../db/schema'
import { getContentExportConfig } from '../utils/content-export-config'
import { describeCmsFailure } from '../utils/cms-sensitive-data'
import {
  commitContentExport,
  compensateContentExportWorkspace,
  ContentExportRepositoryError,
  prepareContentExportWorkspace,
  pushContentExport,
  removeContentExportFile,
  runContentExportGit,
  writeContentExportFile
} from './content-export-repository'
import {
  buildContentTakeoverReport,
  contentTakeoverConfirmation,
  loadDatabaseContentExportSnapshot,
  readContentRepositorySnapshot,
  readRepositoryFile,
  takeoverMetadataFiles,
  type ContentTakeoverReport
} from './content-export-snapshot'
import { sha256ContentBytes } from './content-export-serialization'

export const CONTENT_EXPORT_LOCK_NAME = 'vinci:v2:content-export-worker'

interface ClaimedContentExportJob {
  id: string
  targetType: string
  targetId: string
  revisionId: string | null
  memberRevisionId: string | null
  operation: string
  attemptCount: number
  targetPath: string | null
  previousPath: string | null
  expectedSha256: string | null
}

export interface ContentExportWorkerResult {
  state: 'idle' | 'busy' | 'succeeded' | 'failed'
  runId: string | null
  jobCount: number
  commitHash: string | null
  retrying: number
  failed: number
}

const workerId = () =>
  `${hostname().slice(0, 64)}:${process.pid}:${randomUUID().slice(0, 8)}`

const errorCode = (error: unknown) => {
  if (error instanceof ContentExportRepositoryError) return error.code
  if (error instanceof Error && /^[A-Z0-9_]{3,64}$/.test(error.message)) {
    return error.message
  }
  return 'CONTENT_EXPORT_FAILED'
}

const retryDelaySeconds = (attemptCount: number) => {
  const config = getContentExportConfig()
  return Math.min(
    config.CONTENT_EXPORT_RETRY_MAX_SECONDS,
    config.CONTENT_EXPORT_RETRY_BASE_SECONDS * (2 ** Math.max(0, attemptCount - 1))
  )
}

const recoverExpiredLeases = async () => {
  const config = getContentExportConfig()
  await getDatabase().execute(sql`
    with recovered as (
      update ${contentExportJobs}
      set
        status = case
          when ${contentExportJobs.attemptCount} >= ${config.CONTENT_EXPORT_MAX_ATTEMPTS}
            then 'failed'
          else 'pending'
        end,
        next_attempt_at = now(),
        last_error_code = 'CONTENT_EXPORT_LEASE_EXPIRED',
        last_error = '导出 Worker 租约过期；任务已安全回收',
        lease_owner = null,
        lease_expires_at = null,
        completed_at = case
          when ${contentExportJobs.attemptCount} >= ${config.CONTENT_EXPORT_MAX_ATTEMPTS}
            then now()
          else null
        end,
        updated_at = now()
      where
        ${contentExportJobs.status} = 'processing'
        and ${contentExportJobs.leaseExpiresAt} is not null
        and ${contentExportJobs.leaseExpiresAt} <= now()
      returning latest_run_id
    )
    update ${contentExportRuns}
    set
      status = 'failed',
      error_code = 'CONTENT_EXPORT_LEASE_EXPIRED',
      error_summary = '导出 Worker 租约过期；任务已安全回收',
      report = jsonb_build_object('leaseExpired', true),
      completed_at = now()
    where
      ${contentExportRuns.status} = 'processing'
      and ${contentExportRuns.id} in (
        select latest_run_id from recovered where latest_run_id is not null
      )
  `)
}

const claimJobs = async (
  owner: string
): Promise<{ runId: string, jobs: ClaimedContentExportJob[] } | null> => {
  const config = getContentExportConfig()
  const client = await getDatabasePool().connect()
  const runId = randomUUID()
  try {
    await client.query('begin')
    const selected = await client.query<{ id: string }>(
      `
        select id
        from content_export_jobs
        where status = 'pending' and next_attempt_at <= now()
        order by created_at, id
        for update skip locked
        limit $1
      `,
      [config.CONTENT_EXPORT_BATCH_SIZE]
    )
    if (!selected.rowCount) {
      await client.query('commit')
      return null
    }
    const ids = selected.rows.map(row => row.id)
    await client.query(
      `
        insert into content_export_runs (
          id, trigger, status, worker_id, job_count, started_at
        ) values ($1, 'worker', 'processing', $2, $3, now())
      `,
      [runId, owner, ids.length]
    )
    const claimed = await client.query<{
      id: string
      target_type: string
      target_id: string
      revision_id: string | null
      member_revision_id: string | null
      operation: string
      attempt_count: number
      target_path: string | null
      previous_path: string | null
      expected_sha256: string | null
    }>(
      `
        update content_export_jobs
        set
          status = 'processing',
          attempt_count = attempt_count + 1,
          lease_owner = $2,
          lease_expires_at = now() + make_interval(secs => $3),
          latest_run_id = $4,
          updated_at = now()
        where id = any($1::uuid[])
        returning
          id, target_type, target_id, revision_id, member_revision_id, operation, attempt_count,
          target_path, previous_path, expected_sha256
      `,
      [ids, owner, config.CONTENT_EXPORT_LEASE_SECONDS, runId]
    )
    await client.query('commit')
    return {
      runId,
      jobs: claimed.rows.map(row => ({
        id: row.id,
        targetType: row.target_type,
        targetId: row.target_id,
        revisionId: row.revision_id,
        memberRevisionId: row.member_revision_id,
        operation: row.operation,
        attemptCount: row.attempt_count,
        targetPath: row.target_path,
        previousPath: row.previous_path,
        expectedSha256: row.expected_sha256
      }))
    }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

const verifyRepositoryBase = async (
  affectedArticleIds: Set<string>,
  affectedMemberIds: Set<string>
) => {
  const config = getContentExportConfig()
  const snapshotSource = await readRepositoryFile(
    config.CONTENT_EXPORT_WORKSPACE,
    '.vinci/snapshot.json'
  )
  const manifestSource = await readRepositoryFile(
    config.CONTENT_EXPORT_WORKSPACE,
    'manifest.json'
  )
  if (snapshotSource === null || manifestSource === null) {
    throw new Error('CONTENT_EXPORT_TAKEOVER_REQUIRED')
  }
  const parsed = await readContentRepositorySnapshot(config.CONTENT_EXPORT_WORKSPACE)
  if (!parsed) throw new Error('CONTENT_EXPORT_TAKEOVER_REQUIRED')
  const manifest = JSON.parse(manifestSource) as {
    snapshot?: { path?: string, sha256?: string }
  }
  if (
    manifest.snapshot?.path !== '.vinci/snapshot.json'
    || manifest.snapshot.sha256 !== sha256ContentBytes(snapshotSource)
  ) {
    throw new Error('CONTENT_EXPORT_BASE_MANIFEST_INVALID')
  }
  for (const file of parsed.files) {
    if (affectedArticleIds.has(file.articleId)) continue
    const source = await readRepositoryFile(config.CONTENT_EXPORT_WORKSPACE, file.path)
    if (source === null || sha256ContentBytes(source) !== file.sha256) {
      throw new Error('CONTENT_EXPORT_BASE_DRIFT')
    }
  }
  for (const file of parsed.members) {
    if (affectedMemberIds.has(file.memberId)) continue
    const source = await readRepositoryFile(config.CONTENT_EXPORT_WORKSPACE, file.path)
    if (source === null || sha256ContentBytes(source) !== file.sha256) {
      throw new Error('CONTENT_EXPORT_BASE_DRIFT')
    }
  }
}

const applyCurrentDatabaseState = async (
  jobs: ClaimedContentExportJob[]
) => {
  const config = getContentExportConfig()
  const snapshot = await loadDatabaseContentExportSnapshot()
  const itemByArticle = new Map(snapshot.items.map(item => [item.articleId, item]))
  const itemByMember = new Map(snapshot.memberItems.map(item => [item.memberId, item]))
  const affectedArticleIds = new Set(jobs.filter(job => job.targetType === 'article').map(job => job.targetId))
  const affectedMemberIds = new Set(jobs.filter(job => job.targetType === 'member').map(job => job.targetId))
  await verifyRepositoryBase(affectedArticleIds, affectedMemberIds)

  let fileWriteCount = 0
  let fileDeleteCount = 0
  let noopCount = 0
  const finalByJob = new Map<string, {
    path: string | null
    sha256: string | null
  }>()
  const jobsByArticle = new Map<string, ClaimedContentExportJob[]>()
  const jobsByMember = new Map<string, ClaimedContentExportJob[]>()
  for (const job of jobs) {
    const target = job.targetType === 'article' ? jobsByArticle
      : job.targetType === 'member' ? jobsByMember : null
    if (!target) throw new Error('CONTENT_EXPORT_TARGET_INVALID')
    const grouped = target.get(job.targetId) || []
    grouped.push(job)
    target.set(job.targetId, grouped)
  }

  for (const [memberId, memberJobs] of jobsByMember) {
    const item = itemByMember.get(memberId)
    if (!item) throw new Error('CONTENT_EXPORT_MEMBER_REVISION_MISSING')
    if (item.deleted) {
      if (await removeContentExportFile(item.serialized.path)) fileDeleteCount += 1
      else noopCount += 1
      for (const job of memberJobs) finalByJob.set(job.id, { path: null, sha256: null })
      continue
    }
    const changed = await writeContentExportFile(item.serialized.path, item.serialized.source)
    if (changed) fileWriteCount += 1
    else noopCount += 1
    for (const job of memberJobs) {
      if (job.memberRevisionId === item.revisionId && job.targetPath && job.targetPath !== item.serialized.path) {
        throw new Error('CONTENT_EXPORT_JOB_TARGET_MISMATCH')
      }
      if (job.memberRevisionId === item.revisionId && job.expectedSha256 && job.expectedSha256 !== item.serialized.sha256) {
        throw new Error('CONTENT_EXPORT_JOB_HASH_MISMATCH')
      }
      finalByJob.set(job.id, { path: item.serialized.path, sha256: item.serialized.sha256 })
    }
  }

  for (const [articleId, articleJobs] of jobsByArticle) {
    const item = itemByArticle.get(articleId)
    if (!item) throw new Error('CONTENT_EXPORT_ARTICLE_REVISION_MISSING')
    const obsoletePaths = new Set(
      articleJobs
        .map(job => job.previousPath)
        .filter((path): path is string => Boolean(path))
    )
    for (const path of obsoletePaths) {
      if (path !== item.serialized.path && await removeContentExportFile(path)) {
        fileDeleteCount += 1
      }
    }
    if (item.deleted) {
      if (await removeContentExportFile(item.serialized.path)) {
        fileDeleteCount += 1
      } else {
        noopCount += 1
      }
      for (const job of articleJobs) {
        finalByJob.set(job.id, { path: null, sha256: null })
      }
      continue
    }
    const changed = await writeContentExportFile(
      item.serialized.path,
      item.serialized.source
    )
    if (changed) fileWriteCount += 1
    else noopCount += 1
    for (const job of articleJobs) {
      if (
        job.revisionId === item.revisionId
        && job.targetPath
        && job.targetPath !== item.serialized.path
      ) {
        throw new Error('CONTENT_EXPORT_JOB_TARGET_MISMATCH')
      }
      if (
        job.revisionId === item.revisionId
        && job.expectedSha256
        && job.expectedSha256 !== item.serialized.sha256
      ) {
        throw new Error('CONTENT_EXPORT_JOB_HASH_MISMATCH')
      }
      finalByJob.set(job.id, {
        path: item.serialized.path,
        sha256: item.serialized.sha256
      })
    }
  }

  for (const file of takeoverMetadataFiles(snapshot)) {
    if (await writeContentExportFile(file.path, file.source)) fileWriteCount += 1
    else noopCount += 1
  }
  const stagedPaths = await runContentExportGitStagedPaths()
  return {
    snapshot,
    finalByJob,
    fileWriteCount,
    fileDeleteCount,
    noopCount,
    stagedPaths
  }
}

const runContentExportGitStagedPaths = async () => {
  const output = await runContentExportGit(['diff', '--cached', '--name-only'])
  return output ? output.split('\n').filter(Boolean) : []
}

const completeJobs = async (
  runId: string,
  jobs: ClaimedContentExportJob[],
  result: Awaited<ReturnType<typeof applyCurrentDatabaseState>>,
  commitHash: string,
  baseCommit: string,
  localCommitHash: string | null
) => {
  const db = getDatabase()
  await db.transaction(async (tx) => {
    for (const job of jobs) {
      const final = result.finalByJob.get(job.id)
      if (!final) throw new Error('CONTENT_EXPORT_JOB_RESULT_MISSING')
      await tx
        .update(contentExportJobs)
        .set({
          status: 'succeeded',
          lastError: null,
          lastErrorCode: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          exportedPath: final.path,
          exportedSha256: final.sha256,
          exportedCommitHash: commitHash,
          completedAt: new Date(),
          updatedAt: new Date()
        })
        .where(and(
          eq(contentExportJobs.id, job.id),
          eq(contentExportJobs.status, 'processing'),
          eq(contentExportJobs.latestRunId, runId)
        ))
    }
    await tx
      .update(contentExportRuns)
      .set({
        status: 'succeeded',
        baseCommitHash: baseCommit,
        localCommitHash,
        resultCommitHash: commitHash,
        fileWriteCount: result.fileWriteCount,
        fileDeleteCount: result.fileDeleteCount,
        noopCount: result.noopCount,
        report: {
          stagedPaths: result.stagedPaths,
          snapshotSha256: result.snapshot.metadata.snapshotSha256,
          manifestSha256: result.snapshot.metadata.manifestSha256
        },
        completedAt: new Date()
      })
      .where(eq(contentExportRuns.id, runId))
  })
}

const failJobs = async (
  runId: string,
  jobs: ClaimedContentExportJob[],
  error: unknown,
  compensationError?: unknown
) => {
  const config = getContentExportConfig()
  const code = errorCode(error)
  const summary = describeCmsFailure(error, 1000)
  const compensationSummary = compensationError
    ? describeCmsFailure(compensationError, 500)
    : null
  let retrying = 0
  let failed = 0
  await getDatabase().transaction(async (tx) => {
    for (const job of jobs) {
      const finalFailure = job.attemptCount >= config.CONTENT_EXPORT_MAX_ATTEMPTS
      if (finalFailure) failed += 1
      else retrying += 1
      const nextAttemptAt = new Date(
        Date.now() + retryDelaySeconds(job.attemptCount) * 1000
      )
      await tx
        .update(contentExportJobs)
        .set({
          status: finalFailure ? 'failed' : 'pending',
          nextAttemptAt,
          lastErrorCode: code,
          lastError: summary,
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: new Date()
        })
        .where(and(
          eq(contentExportJobs.id, job.id),
          eq(contentExportJobs.latestRunId, runId)
        ))
    }
    await tx
      .update(contentExportRuns)
      .set({
        status: 'failed',
        errorCode: code,
        errorSummary: summary,
        report: {
          retrying,
          failed,
          compensationError: compensationSummary
        },
        completedAt: new Date()
      })
      .where(eq(contentExportRuns.id, runId))
  })
  return { retrying, failed }
}

export const runContentExportWorkerOnce = async (): Promise<ContentExportWorkerResult> => {
  const config = getContentExportConfig()
  if (config.CONTENT_EXPORT_MODE !== 'enabled') {
    throw new Error('CONTENT_EXPORT_MODE_NOT_ENABLED')
  }
  const lockClient = await getDatabasePool().connect()
  const owner = workerId()
  let acquired = false
  try {
    acquired = Boolean((await lockClient.query<{ acquired: boolean }>(
      'select pg_try_advisory_lock(hashtextextended($1, 0)) as acquired',
      [CONTENT_EXPORT_LOCK_NAME]
    )).rows[0]?.acquired)
    if (!acquired) {
      return {
        state: 'busy',
        runId: null,
        jobCount: 0,
        commitHash: null,
        retrying: 0,
        failed: 0
      }
    }
    await recoverExpiredLeases()
    const claimed = await claimJobs(owner)
    if (!claimed) {
      return {
        state: 'idle',
        runId: null,
        jobCount: 0,
        commitHash: null,
        retrying: 0,
        failed: 0
      }
    }
    let baseCommit: string | null = null
    let localCommitHash: string | null = null
    try {
      baseCommit = await prepareContentExportWorkspace()
      const result = await applyCurrentDatabaseState(claimed.jobs)
      localCommitHash = await commitContentExport(
        `content: export ${claimed.jobs.length} database change${claimed.jobs.length === 1 ? '' : 's'}\n\nVinci-Export-Run: ${claimed.runId}`
      )
      const commitHash = localCommitHash
        ? await pushContentExport(baseCommit)
        : baseCommit
      await completeJobs(
        claimed.runId,
        claimed.jobs,
        result,
        commitHash,
        baseCommit,
        localCommitHash
      )
      return {
        state: 'succeeded',
        runId: claimed.runId,
        jobCount: claimed.jobs.length,
        commitHash,
        retrying: 0,
        failed: 0
      }
    } catch (error) {
      let compensationError: unknown
      try {
        await compensateContentExportWorkspace()
      } catch (value) {
        compensationError = value
      }
      const outcome = await failJobs(
        claimed.runId,
        claimed.jobs,
        error,
        compensationError
      )
      return {
        state: 'failed',
        runId: claimed.runId,
        jobCount: claimed.jobs.length,
        commitHash: localCommitHash,
        ...outcome
      }
    }
  } finally {
    if (acquired) {
      await lockClient.query(
        'select pg_advisory_unlock(hashtextextended($1, 0))',
        [CONTENT_EXPORT_LOCK_NAME]
      )
    }
    lockClient.release()
  }
}

export const runContentTakeoverDryRun = async (): Promise<ContentTakeoverReport> => {
  const config = getContentExportConfig()
  if (config.CONTENT_EXPORT_MODE === 'disabled') {
    throw new Error('CONTENT_EXPORT_MODE_DISABLED')
  }
  const snapshot = await loadDatabaseContentExportSnapshot()
  const { withTemporaryReadOnlyContentClone } = await import(
    './content-export-repository'
  )
  return withTemporaryReadOnlyContentClone(workspace =>
    buildContentTakeoverReport(workspace, snapshot)
  )
}

export const applyContentTakeover = async (
  confirmation: string
) => {
  const config = getContentExportConfig()
  if (config.CONTENT_EXPORT_MODE !== 'enabled') {
    throw new Error('CONTENT_EXPORT_MODE_NOT_ENABLED')
  }
  const lockClient = await getDatabasePool().connect()
  let acquired = false
  try {
    acquired = Boolean((await lockClient.query<{ acquired: boolean }>(
      'select pg_try_advisory_lock(hashtextextended($1, 0)) as acquired',
      [CONTENT_EXPORT_LOCK_NAME]
    )).rows[0]?.acquired)
    if (!acquired) throw new Error('CONTENT_EXPORT_WORKER_BUSY')

    const snapshot = await loadDatabaseContentExportSnapshot()
    const baseCommit = await prepareContentExportWorkspace()
    const report = await buildContentTakeoverReport(
      config.CONTENT_EXPORT_WORKSPACE,
      snapshot
    )
    if (!report.clean || report.conflicts.length) {
      throw new Error('CONTENT_EXPORT_TAKEOVER_CONFLICT')
    }
    if (confirmation !== contentTakeoverConfirmation(report)) {
      throw new Error('CONTENT_EXPORT_TAKEOVER_CONFIRMATION_INVALID')
    }

    const runId = randomUUID()
    await getDatabase().insert(contentExportRuns).values({
      id: runId,
      trigger: 'takeover',
      status: 'processing',
      workerId: workerId(),
      baseCommitHash: baseCommit,
      jobCount: snapshot.items.length + snapshot.memberItems.length,
      report: JSON.parse(JSON.stringify(report)) as Record<string, unknown>
    })
    let localCommitHash: string | null = null
    try {
    let fileWriteCount = 0
    let fileDeleteCount = 0
    let noopCount = 0
    for (const action of report.actions) {
      if (
        action.sourcePath
        && action.sourcePath !== action.targetPath
        && ['move_and_update', 'remove_legacy', 'delete'].includes(action.action)
      ) {
        if (await removeContentExportFile(action.sourcePath)) fileDeleteCount += 1
        else noopCount += 1
      }
      if (action.action === 'delete' && action.sourcePath === action.targetPath) {
        if (await removeContentExportFile(action.targetPath)) fileDeleteCount += 1
        else noopCount += 1
      }
    }
    for (const item of snapshot.activeItems) {
      if (await writeContentExportFile(item.serialized.path, item.serialized.source)) {
        fileWriteCount += 1
      } else {
        noopCount += 1
      }
    }
    for (const item of snapshot.activeMemberItems) {
      if (await writeContentExportFile(item.serialized.path, item.serialized.source)) fileWriteCount += 1
      else noopCount += 1
    }
    for (const file of takeoverMetadataFiles(snapshot)) {
      if (await writeContentExportFile(file.path, file.source)) fileWriteCount += 1
      else noopCount += 1
    }
    localCommitHash = await commitContentExport(
      `content: take over database snapshot\n\nVinci-Export-Run: ${runId}\nVinci-Takeover-Report: ${report.reportSha256}`
    )
    const commitHash = localCommitHash
      ? await pushContentExport(baseCommit)
      : baseCommit

    await getDatabase().transaction(async (tx) => {
      for (const item of snapshot.items) {
        await tx
          .update(contentExportJobs)
          .set({
            status: 'succeeded',
            lastError: null,
            lastErrorCode: null,
            leaseOwner: null,
            leaseExpiresAt: null,
            latestRunId: runId,
            exportedPath: item.deleted ? null : item.serialized.path,
            exportedSha256: item.deleted ? null : item.serialized.sha256,
            exportedCommitHash: commitHash,
            completedAt: new Date(),
            updatedAt: new Date()
          })
          .where(and(
            eq(contentExportJobs.targetType, 'article'),
            eq(contentExportJobs.targetId, item.articleId),
            ne(contentExportJobs.status, 'succeeded')
          ))
      }
      for (const item of snapshot.memberItems) {
        await tx.update(contentExportJobs).set({
          status: 'succeeded', lastError: null, lastErrorCode: null,
          leaseOwner: null, leaseExpiresAt: null, latestRunId: runId,
          exportedPath: item.deleted ? null : item.serialized.path,
          exportedSha256: item.deleted ? null : item.serialized.sha256,
          exportedCommitHash: commitHash, completedAt: new Date(), updatedAt: new Date()
        }).where(and(
          eq(contentExportJobs.targetType, 'member'),
          eq(contentExportJobs.targetId, item.memberId), ne(contentExportJobs.status, 'succeeded')
        ))
      }
      await tx
        .update(contentExportRuns)
        .set({
          status: 'succeeded',
          localCommitHash,
          resultCommitHash: commitHash,
          fileWriteCount,
          fileDeleteCount,
          noopCount,
          completedAt: new Date()
        })
        .where(eq(contentExportRuns.id, runId))
    })
      return { runId, commitHash, report }
    } catch (error) {
      let compensationError: unknown
      try {
        await compensateContentExportWorkspace()
      } catch (value) {
        compensationError = value
      }
      await getDatabase()
        .update(contentExportRuns)
        .set({
          status: 'failed',
          localCommitHash,
          errorCode: errorCode(error),
          errorSummary: describeCmsFailure(error, 1000),
          report: {
            takeoverReportSha256: report.reportSha256,
            compensationError: compensationError
              ? describeCmsFailure(compensationError, 500)
              : null
          },
          completedAt: new Date()
        })
        .where(eq(contentExportRuns.id, runId))
      throw error
    }
  } finally {
    if (acquired) {
      await lockClient.query(
        'select pg_advisory_unlock(hashtextextended($1, 0))',
        [CONTENT_EXPORT_LOCK_NAME]
      )
    }
    lockClient.release()
  }
}

export const retryContentExportJob = async (
  jobId: string,
  actorUserId: string
) => {
  const db = getDatabase()
  return db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(contentExportJobs)
      .where(eq(contentExportJobs.id, jobId))
      .limit(1)
      .for('update')
    if (!job) throw new Error('CONTENT_EXPORT_JOB_NOT_FOUND')
    if (job.status !== 'failed') throw new Error('CONTENT_EXPORT_JOB_NOT_FAILED')
    const now = new Date()
    await tx
      .update(contentExportJobs)
      .set({
        status: 'pending',
        attemptCount: 0,
        nextAttemptAt: now,
        lastError: null,
        lastErrorCode: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        completedAt: null,
        updatedAt: now
      })
      .where(eq(contentExportJobs.id, jobId))
    await tx.insert(auditLogs).values({
      actorUserId,
      action: 'content_export.retry',
      targetType: 'content_export_job',
      targetId: jobId,
      metadata: {
        previousAttemptCount: job.attemptCount,
        revisionId: job.revisionId,
        targetId: job.targetId
      }
    })
    return {
      id: jobId,
      status: 'pending' as const,
      attemptCount: 0,
      previousAttemptCount: job.attemptCount,
      nextAttemptAt: now.toISOString()
    }
  })
}
