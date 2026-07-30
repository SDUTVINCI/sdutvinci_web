import { and, asc, eq, inArray } from 'drizzle-orm'
import { getDatabase } from '../db/client'
import { contentExportJobs, contentExportRuns } from '../db/schema'
import { getContentExportConfig } from '../utils/content-export-config'
import {
  ensureContentExportWorkspace,
  runContentExportGit
} from './content-export-repository'
import {
  loadDatabaseContentExportSnapshot,
  readContentRepositorySnapshot,
  readRepositoryFile
} from './content-export-snapshot'
import { sha256ContentBytes } from './content-export-serialization'

export interface ContentExportConsistencyIssue {
  code: string
  targetType: 'job' | 'run' | 'repository' | 'article'
  targetId: string
  message: string
}

export const checkContentExportConsistency = async () => {
  const config = getContentExportConfig()
  const [jobs, runs, databaseSnapshot] = await Promise.all([
    getDatabase()
      .select()
      .from(contentExportJobs)
      .orderBy(asc(contentExportJobs.createdAt)),
    getDatabase()
      .select()
      .from(contentExportRuns)
      .orderBy(asc(contentExportRuns.startedAt)),
    loadDatabaseContentExportSnapshot()
  ])
  const issues: ContentExportConsistencyIssue[] = []
  const now = new Date()
  for (const job of jobs) {
    if (job.status === 'processing') {
      if (!job.leaseOwner || !job.leaseExpiresAt || job.leaseExpiresAt <= now) {
        issues.push({
          code: 'PROCESSING_LEASE_INVALID',
          targetType: 'job',
          targetId: job.id,
          message: 'processing 任务缺少有效租约'
        })
      }
    } else if (job.leaseOwner || job.leaseExpiresAt) {
      issues.push({
        code: 'INACTIVE_JOB_HAS_LEASE',
        targetType: 'job',
        targetId: job.id,
        message: '非 processing 任务仍保留租约'
      })
    }
    if (
      job.status === 'succeeded'
      && (
        !job.completedAt
        || !job.exportedCommitHash
        || !/^[0-9a-f]{40}$/.test(job.exportedCommitHash)
      )
    ) {
      issues.push({
        code: 'SUCCEEDED_JOB_INCOMPLETE',
        targetType: 'job',
        targetId: job.id,
        message: '成功任务缺少完成时间或 40 位导出 Commit'
      })
    }
    if (
      job.status === 'failed'
      && (
        job.attemptCount < config.CONTENT_EXPORT_MAX_ATTEMPTS
        || !job.lastErrorCode
      )
    ) {
      issues.push({
        code: 'FAILED_JOB_RETRY_STATE_INVALID',
        targetType: 'job',
        targetId: job.id,
        message: '失败任务尚未达到上限或缺少脱敏错误码'
      })
    }
  }
  for (const run of runs) {
    if (run.status === 'succeeded' && (
      !run.completedAt
      || !run.resultCommitHash
      || !/^[0-9a-f]{40}$/.test(run.resultCommitHash)
    )) {
      issues.push({
        code: 'SUCCEEDED_RUN_INCOMPLETE',
        targetType: 'run',
        targetId: run.id,
        message: '成功导出运行缺少完成时间或结果 Commit'
      })
    }
    if (run.status === 'failed' && (!run.completedAt || !run.errorCode)) {
      issues.push({
        code: 'FAILED_RUN_INCOMPLETE',
        targetType: 'run',
        targetId: run.id,
        message: '失败导出运行缺少完成时间或错误码'
      })
    }
  }

  await ensureContentExportWorkspace()
  const [
    status,
    branch,
    head,
    remoteHeadOutput,
    repositorySnapshot,
    snapshotSource,
    manifestSource
  ] =
    await Promise.all([
      runContentExportGit(['status', '--porcelain=v1']),
      runContentExportGit(['branch', '--show-current']),
      runContentExportGit(['rev-parse', 'HEAD']),
      runContentExportGit([
        'ls-remote',
        '--heads',
        config.CONTENT_EXPORT_REMOTE,
        `refs/heads/${config.CONTENT_EXPORT_BRANCH}`
      ]),
      readContentRepositorySnapshot(config.CONTENT_EXPORT_WORKSPACE),
      readRepositoryFile(config.CONTENT_EXPORT_WORKSPACE, '.vinci/snapshot.json'),
      readRepositoryFile(config.CONTENT_EXPORT_WORKSPACE, 'manifest.json')
    ])
  const remoteHead = remoteHeadOutput.split(/\s+/)[0] || ''
  if (status) {
    issues.push({
      code: 'REPOSITORY_DIRTY',
      targetType: 'repository',
      targetId: head,
      message: '独立内容导出工作区存在未提交修改'
    })
  }
  if (branch !== 'main') {
    issues.push({
      code: 'REPOSITORY_BRANCH_INVALID',
      targetType: 'repository',
      targetId: branch,
      message: '独立内容导出工作区不在 main'
    })
  }
  if (remoteHead !== head) {
    issues.push({
      code: 'REPOSITORY_REMOTE_HEAD_MISMATCH',
      targetType: 'repository',
      targetId: head,
      message: '独立工作区 HEAD 与远端 main 不一致'
    })
  }
  if (!repositorySnapshot || snapshotSource === null || manifestSource === null) {
    issues.push({
      code: 'REPOSITORY_METADATA_MISSING',
      targetType: 'repository',
      targetId: head,
      message: 'snapshot 或 manifest 缺失'
    })
  } else {
    const fileByArticle = new Map(
      repositorySnapshot.files.map(file => [file.articleId, file])
    )
    const tombstoneByArticle = new Map(
      repositorySnapshot.tombstones.map(item => [item.articleId, item])
    )
    for (const item of databaseSnapshot.activeItems) {
      const file = fileByArticle.get(item.articleId)
      if (
        !file
        || file.revisionId !== item.revisionId
        || file.path !== item.serialized.path
        || file.sha256 !== item.serialized.sha256
      ) {
        issues.push({
          code: 'ARTICLE_SNAPSHOT_MISMATCH',
          targetType: 'article',
          targetId: item.articleId,
          message: '数据库当前 Revision 与 snapshot 不一致'
        })
        continue
      }
      const source = await readRepositoryFile(
        config.CONTENT_EXPORT_WORKSPACE,
        file.path
      )
      if (source === null || sha256ContentBytes(source) !== file.sha256) {
        issues.push({
          code: 'ARTICLE_FILE_MISMATCH',
          targetType: 'article',
          targetId: item.articleId,
          message: 'snapshot 指向的 Markdown 文件缺失或哈希不一致'
        })
      }
    }
    for (const item of databaseSnapshot.deletedItems) {
      const tombstone = tombstoneByArticle.get(item.articleId)
      if (!tombstone || tombstone.revisionId !== item.revisionId) {
        issues.push({
          code: 'ARTICLE_TOMBSTONE_MISMATCH',
          targetType: 'article',
          targetId: item.articleId,
          message: '数据库删除状态与 snapshot tombstone 不一致'
        })
      }
      if (await readRepositoryFile(
        config.CONTENT_EXPORT_WORKSPACE,
        item.serialized.path
      ) !== null) {
        issues.push({
          code: 'DELETED_ARTICLE_FILE_PRESENT',
          targetType: 'article',
          targetId: item.articleId,
          message: '已删除文章仍存在于内容仓库受控路径'
        })
      }
    }
    const manifest = JSON.parse(manifestSource) as {
      snapshot?: { sha256?: string }
    }
    if (manifest.snapshot?.sha256 !== sha256ContentBytes(snapshotSource)) {
      issues.push({
        code: 'MANIFEST_SNAPSHOT_HASH_MISMATCH',
        targetType: 'repository',
        targetId: head,
        message: 'manifest 记录的 snapshot 哈希不正确'
      })
    }
  }

  return {
    repository: {
      id: config.CONTENT_REPOSITORY_ID,
      branch,
      head,
      remoteHead
    },
    counts: {
      jobs: jobs.length,
      runs: runs.length,
      databaseFiles: databaseSnapshot.activeItems.length,
      databaseTombstones: databaseSnapshot.deletedItems.length
    },
    issueCount: issues.length,
    issues
  }
}
