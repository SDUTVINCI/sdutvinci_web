import { createHash, randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { eq } from 'drizzle-orm'
import { getDatabase, getDatabasePool } from '../db/client'
import { contentReconciliationRuns } from '../db/schema'
import { describeCmsFailure } from '../utils/cms-sensitive-data'
import { getContentExportConfig } from '../utils/content-export-config'
import { getContentRecoveryConfig } from '../utils/content-recovery-config'
import {
  commitContentExport,
  compensateContentExportWorkspace,
  prepareContentExportWorkspace,
  pushContentExport,
  removeContentExportFile,
  writeContentExportFile
} from './content-export-repository'
import {
  loadDatabaseContentExportSnapshot,
  readContentRepositorySnapshot,
  readRepositoryFile,
  takeoverMetadataFiles
} from './content-export-snapshot'
import { sha256ContentBytes } from './content-export-serialization'
import { CONTENT_EXPORT_LOCK_NAME } from './content-export-worker'

const reconciliationMarker = 'vinci-content-reconciliation-root-v1\n'
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const safeErrorCode = (error: unknown) => {
  const message = error instanceof Error ? error.message : ''
  const candidate = message.split(':', 1)[0]
  return /^[A-Z][A-Z0-9_]{2,63}$/.test(candidate || '')
    ? candidate
    : 'CONTENT_RECONCILIATION_FAILED'
}

export interface ContentReconciliationDifference {
  category: 'database_new' | 'repository_missing' | 'modified' | 'extra' | 'metadata'
  path: string
  articleId: string | null
  databaseSha256: string | null
  repositorySha256: string | null
}

export interface ContentReconciliationReport {
  formatVersion: 1
  repositoryId: string
  branch: 'main'
  baseCommit: string
  generatedAt: string
  databaseFileCount: number
  repositoryManagedFileCount: number
  snapshotSha256: string
  manifestSha256: string
  differences: ContentReconciliationDifference[]
  counts: {
    databaseNew: number
    repositoryMissing: number
    modified: number
    extra: number
    metadata: number
    total: number
  }
  reportSha256: string
}

const assertOwnedRoot = async () => {
  const config = getContentRecoveryConfig()
  const markerStat = await lstat(config.marker).catch(() => null)
  if (!markerStat) {
    await writeFile(config.marker, reconciliationMarker, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    })
  } else {
    if (!markerStat.isFile() || markerStat.isSymbolicLink()) {
      throw new Error('CONTENT_RECONCILIATION_ROOT_UNOWNED')
    }
    if (await readFile(config.marker, 'utf8') !== reconciliationMarker) {
      throw new Error('CONTENT_RECONCILIATION_ROOT_UNOWNED')
    }
  }
}

const managedRepositoryPaths = async (workspace: string) => {
  const result: string[] = []
  const visit = async (directory: string, prefix: string) => {
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    })
    for (const entry of entries) {
      const path = join(directory, entry.name)
      const gitPath = `${prefix}/${entry.name}`
      const stat = await lstat(path)
      if (stat.isSymbolicLink()) throw new Error('CONTENT_RECONCILIATION_SYMLINK')
      if (stat.isDirectory()) await visit(path, gitPath)
      else if (stat.isFile()) result.push(gitPath)
      else throw new Error('CONTENT_RECONCILIATION_SPECIAL_FILE')
    }
  }
  await visit(join(workspace, 'news'), 'news')
  await visit(join(workspace, 'wiki'), 'wiki')
  return result.sort()
}

const writeSnapshotDirectory = async (
  runId: string,
  snapshot: Awaited<ReturnType<typeof loadDatabaseContentExportSnapshot>>
) => {
  const config = getContentRecoveryConfig()
  await assertOwnedRoot()
  const staging = resolve(config.temporaryRoot, `${runId}.snapshot`)
  const final = resolve(config.snapshotsRoot, runId)
  if (!staging.startsWith(`${config.temporaryRoot}${sep}`)) {
    throw new Error('CONTENT_RECONCILIATION_PATH_OUTSIDE_ROOT')
  }
  await mkdir(staging, { mode: 0o700 })
  await writeFile(join(staging, '.vinci-owner'), `${runId}\n`, {
    flag: 'wx',
    mode: 0o600
  })
  for (const item of snapshot.activeItems) {
    const target = resolve(staging, item.serialized.path)
    if (!target.startsWith(`${staging}${sep}`)) {
      throw new Error('CONTENT_RECONCILIATION_PATH_OUTSIDE_SNAPSHOT')
    }
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    await writeFile(target, item.serialized.source, { flag: 'wx', mode: 0o600 })
  }
  for (const file of takeoverMetadataFiles(snapshot)) {
    const target = resolve(staging, file.path)
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    await writeFile(target, file.source, { flag: 'wx', mode: 0o600 })
  }
  await rename(staging, final)
  return final
}

const buildReport = async (
  baseCommit: string,
  snapshot: Awaited<ReturnType<typeof loadDatabaseContentExportSnapshot>>
): Promise<ContentReconciliationReport> => {
  const exportConfig = getContentExportConfig()
  const workspace = exportConfig.CONTENT_EXPORT_WORKSPACE
  const repositoryPaths = await managedRepositoryPaths(workspace)
  const repositorySnapshot = await readContentRepositorySnapshot(workspace)
  const repositorySnapshotIds = new Set(
    repositorySnapshot?.files.map(item => item.articleId) || []
  )
  const expectedByPath = new Map(
    snapshot.activeItems.map(item => [item.serialized.path, item])
  )
  const differences: ContentReconciliationDifference[] = []
  for (const item of snapshot.activeItems) {
    const source = await readRepositoryFile(workspace, item.serialized.path)
    if (source === null) {
      differences.push({
        category: repositorySnapshotIds.has(item.articleId)
          ? 'repository_missing'
          : 'database_new',
        path: item.serialized.path,
        articleId: item.articleId,
        databaseSha256: item.serialized.sha256,
        repositorySha256: null
      })
    } else {
      const repositorySha256 = sha256ContentBytes(source)
      if (repositorySha256 !== item.serialized.sha256) {
        differences.push({
          category: 'modified',
          path: item.serialized.path,
          articleId: item.articleId,
          databaseSha256: item.serialized.sha256,
          repositorySha256
        })
      }
    }
  }
  for (const path of repositoryPaths) {
    if (!expectedByPath.has(path)) {
      const source = await readRepositoryFile(workspace, path)
      differences.push({
        category: 'extra',
        path,
        articleId: null,
        databaseSha256: null,
        repositorySha256: source === null ? null : sha256ContentBytes(source)
      })
    }
  }
  for (const file of takeoverMetadataFiles(snapshot).filter(
    item => item.path !== 'README.md'
  )) {
    const source = await readRepositoryFile(workspace, file.path)
    const repositorySha256 = source === null ? null : sha256ContentBytes(source)
    const databaseSha256 = sha256ContentBytes(file.source)
    if (repositorySha256 !== databaseSha256) {
      differences.push({
        category: 'metadata',
        path: file.path,
        articleId: null,
        databaseSha256,
        repositorySha256
      })
    }
  }
  differences.sort((a, b) =>
    a.category.localeCompare(b.category) || a.path.localeCompare(b.path)
  )
  const counts = {
    databaseNew: differences.filter(item => item.category === 'database_new').length,
    repositoryMissing:
      differences.filter(item => item.category === 'repository_missing').length,
    modified: differences.filter(item => item.category === 'modified').length,
    extra: differences.filter(item => item.category === 'extra').length,
    metadata: differences.filter(item => item.category === 'metadata').length,
    total: differences.length
  }
  const withoutHash = {
    formatVersion: 1 as const,
    repositoryId: exportConfig.CONTENT_REPOSITORY_ID,
    branch: 'main' as const,
    baseCommit,
    generatedAt: new Date().toISOString(),
    databaseFileCount: snapshot.activeItems.length,
    repositoryManagedFileCount: repositoryPaths.length,
    snapshotSha256: snapshot.metadata.snapshotSha256,
    manifestSha256: snapshot.metadata.manifestSha256,
    differences,
    counts
  }
  return {
    ...withoutHash,
    reportSha256: sha256(`${JSON.stringify(withoutHash, null, 2)}\n`)
  }
}

const persistReport = async (runId: string, report: ContentReconciliationReport) => {
  const config = getContentRecoveryConfig()
  const path = resolve(config.reportsRoot, `${runId}.json`)
  if (!path.startsWith(`${config.reportsRoot}${sep}`)) {
    throw new Error('CONTENT_RECONCILIATION_REPORT_PATH_INVALID')
  }
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600
  })
  return path
}

export const runContentReconciliation = async (
  trigger: 'schedule' | 'manual' = 'manual'
) => {
  const db = getDatabase()
  const runId = randomUUID()
  await db.insert(contentReconciliationRuns).values({ id: runId, trigger })
  const lockClient = await getDatabasePool().connect()
  let acquired = false
  try {
    acquired = Boolean((await lockClient.query<{ acquired: boolean }>(
      'select pg_try_advisory_lock(hashtextextended($1, 0)) as acquired',
      [CONTENT_EXPORT_LOCK_NAME]
    )).rows[0]?.acquired)
    if (!acquired) {
      await db.update(contentReconciliationRuns).set({
        status: 'busy',
        errorCode: 'CONTENT_EXPORT_WORKER_BUSY',
        errorSummary: '增量导出或其他全量对账正在运行',
        completedAt: new Date()
      }).where(eq(contentReconciliationRuns.id, runId))
      return { state: 'busy' as const, runId, commitHash: null, report: null }
    }
    const baseCommit = await prepareContentExportWorkspace()
    const snapshot = await loadDatabaseContentExportSnapshot()
    await writeSnapshotDirectory(runId, snapshot)
    const report = await buildReport(baseCommit, snapshot)
    const reportPath = await persistReport(runId, report)

    let commitHash = baseCommit
    if (report.counts.total > 0) {
      for (const difference of report.differences) {
        if (difference.category === 'extra') {
          await removeContentExportFile(difference.path)
        }
      }
      for (const item of snapshot.activeItems) {
        await writeContentExportFile(item.serialized.path, item.serialized.source)
      }
      for (const item of snapshot.deletedItems) {
        await removeContentExportFile(item.serialized.path)
      }
      for (const file of takeoverMetadataFiles(snapshot)) {
        await writeContentExportFile(file.path, file.source)
      }
      const localCommit = await commitContentExport(
        `content: reconcile database snapshot\n\nVinci-Reconciliation-Run: ${runId}\nVinci-Reconciliation-Report: ${report.reportSha256}`
      )
      commitHash = localCommit
        ? await pushContentExport(baseCommit)
        : baseCommit
    }
    await db.update(contentReconciliationRuns).set({
      status: 'succeeded',
      baseCommitHash: baseCommit,
      resultCommitHash: commitHash,
      reportSha256: report.reportSha256,
      reportPath,
      addedCount: report.counts.databaseNew,
      missingCount: report.counts.repositoryMissing,
      modifiedCount: report.counts.modified,
      extraCount: report.counts.extra,
      metadataMismatchCount: report.counts.metadata,
      report: JSON.parse(JSON.stringify(report)) as Record<string, unknown>,
      completedAt: new Date()
    }).where(eq(contentReconciliationRuns.id, runId))
    return {
      state: 'succeeded' as const,
      runId,
      commitHash,
      report
    }
  } catch (error) {
    let compensationError: unknown
    try {
      await compensateContentExportWorkspace()
    } catch (value) {
      compensationError = value
    }
    await db.update(contentReconciliationRuns).set({
      status: 'failed',
      errorCode: safeErrorCode(error),
      errorSummary: describeCmsFailure(error, 1000),
      report: compensationError
        ? { compensationError: describeCmsFailure(compensationError, 500) }
        : {},
      completedAt: new Date()
    }).where(eq(contentReconciliationRuns.id, runId))
    throw error
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

export const getLatestContentReconciliation = async () => {
  const rows = await getDatabase()
    .select()
    .from(contentReconciliationRuns)
    .orderBy(contentReconciliationRuns.startedAt)
  return rows.at(-1) || null
}
