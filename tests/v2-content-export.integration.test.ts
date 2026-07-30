import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, getDatabase, getDatabasePool } from '../server/db/client'
import { runMigrations } from '../server/db/migrate'
import {
  articleRevisions,
  articles,
  auditLogs,
  contentExportJobs,
  contentExportRuns,
  users
} from '../server/db/schema'
import { checkContentExportConsistency } from '../server/services/content-export-consistency'
import { getCmsArticleExportStatus } from '../server/services/cms-export-status'
import {
  applyContentTakeover,
  retryContentExportJob,
  runContentExportWorkerOnce,
  runContentTakeoverDryRun
} from '../server/services/content-export-worker'
import {
  serializeContentRevision,
  sha256ContentBytes
} from '../server/services/content-export-serialization'
import { contentTakeoverConfirmation } from '../server/services/content-export-snapshot'
import { parseCmsMarkdown, writeCmsMarkdown } from '../server/utils/cms-frontmatter'
import {
  getContentExportConfig,
  resetContentExportConfigForTests
} from '../server/utils/content-export-config'
import { configureCmsTestDatabase } from './helpers/cms-test-database'

const enabled = configureCmsTestDatabase()
const suite = enabled ? describe : describe.skip
const runFile = promisify(execFile)
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

interface SeededArticle {
  articleId: string
  revisionId: string
  revisionNumber: number
  collection: 'news' | 'wiki'
  relativePath: string
  source: string
  body: string
  frontmatter: Record<string, unknown>
  createdAt: Date
  serialized: ReturnType<typeof serializeContentRevision>
}

suite('V2 阶段 6 独立内容仓库与异步增量导出', () => {
  let root = ''
  let remote = ''
  let workspace = ''
  let actorUserId = ''
  const originalEnvironment = Object.fromEntries(
    [
      'NODE_ENV',
      'CONTENT_REPOSITORY_ID',
      'CONTENT_EXPORT_MODE',
      'CONTENT_EXPORT_REMOTE_URL',
      'CONTENT_EXPORT_REMOTE',
      'CONTENT_EXPORT_BRANCH',
      'CONTENT_EXPORT_WORKSPACE',
      'CONTENT_EXPORT_AUTHOR_NAME',
      'CONTENT_EXPORT_AUTHOR_EMAIL',
      'CONTENT_EXPORT_SSH_KEY_FILE',
      'CONTENT_EXPORT_KNOWN_HOSTS_FILE',
      'CONTENT_EXPORT_BATCH_SIZE',
      'CONTENT_EXPORT_POLL_SECONDS',
      'CONTENT_EXPORT_LEASE_SECONDS',
      'CONTENT_EXPORT_MAX_ATTEMPTS',
      'CONTENT_EXPORT_RETRY_BASE_SECONDS',
      'CONTENT_EXPORT_RETRY_MAX_SECONDS',
      'CONTENT_EXPORT_TEST_MODE',
      'CMS_CONTENT_ROOT',
      'CMS_GIT_WORKTREE'
    ].map(key => [key, process.env[key]])
  )

  const git = async (args: string[], cwd?: string) =>
    (await runFile('git', args, {
      cwd,
      timeout: 30_000,
      maxBuffer: 5 * 1024 * 1024
    })).stdout.trim()

  const gitBytes = async (args: string[], cwd?: string) =>
    (await runFile('git', args, {
      cwd,
      timeout: 30_000,
      maxBuffer: 5 * 1024 * 1024
    })).stdout

  const configureEnvironment = (mode: 'dry_run' | 'enabled') => {
    process.env.NODE_ENV = 'test'
    process.env.CONTENT_REPOSITORY_ID = 'SDUTVINCI/sdutvinci_content'
    process.env.CONTENT_EXPORT_MODE = mode
    process.env.CONTENT_EXPORT_REMOTE_URL = remote
    process.env.CONTENT_EXPORT_REMOTE = 'origin'
    process.env.CONTENT_EXPORT_BRANCH = 'main'
    process.env.CONTENT_EXPORT_WORKSPACE = workspace
    process.env.CONTENT_EXPORT_AUTHOR_NAME = 'Phase 6 Test Exporter'
    process.env.CONTENT_EXPORT_AUTHOR_EMAIL = 'phase6-test@example.invalid'
    process.env.CONTENT_EXPORT_BATCH_SIZE = '50'
    process.env.CONTENT_EXPORT_POLL_SECONDS = '1'
    process.env.CONTENT_EXPORT_LEASE_SECONDS = '30'
    process.env.CONTENT_EXPORT_MAX_ATTEMPTS = '3'
    process.env.CONTENT_EXPORT_RETRY_BASE_SECONDS = '1'
    process.env.CONTENT_EXPORT_RETRY_MAX_SECONDS = '4'
    process.env.CONTENT_EXPORT_TEST_MODE = 'true'
    process.env.CMS_CONTENT_ROOT = join(root, 'legacy-content-root')
    process.env.CMS_GIT_WORKTREE = join(root, 'legacy-cms-worktree')
    resetContentExportConfigForTests()
  }

  const seedArticle = async (
    collection: 'news' | 'wiki',
    relativePath: string,
    title: string,
    body: string
  ): Promise<SeededArticle> => {
    const frontmatter = {
      title,
      description: `${title} description`,
      tags: collection === 'news' ? ['phase6', 'test'] : undefined,
      ambiguous: 'true',
      zUnknown: '末尾',
      aUnknown: { z: 2, a: 1 },
      publishedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
    const source = writeCmsMarkdown(frontmatter, body)
    const parsed = parseCmsMarkdown(source)
    const [article] = await getDatabase().insert(articles).values({
      collection,
      relativePath,
      publicPath: `/${collection}/${relativePath.replace(/\.md$/, '')}`,
      directory: collection,
      title,
      frontmatter: parsed.frontmatter,
      searchText: `${title}\n${body}`.toLowerCase(),
      contentHash: sha256(source)
    }).returning()
    const createdAt = new Date('2026-01-01T00:00:00.000Z')
    const [revision] = await getDatabase().insert(articleRevisions).values({
      articleId: article!.id,
      revisionNumber: 1,
      markdownSource: source,
      body: parsed.body,
      frontmatter: parsed.frontmatter,
      contentHash: sha256(source),
      sourceKind: 'backfill',
      createdAt
    }).returning()
    await getDatabase().update(articles).set({
      currentRevisionId: revision!.id
    }).where(eq(articles.id, article!.id))
    const serialized = serializeContentRevision({
      articleId: article!.id,
      collection,
      relativePath,
      revisionId: revision!.id,
      revisionNumber: revision!.revisionNumber,
      frontmatter: revision!.frontmatter,
      body: revision!.body,
      revisionCreatedAt: revision!.createdAt
    })
    await getDatabase().insert(contentExportJobs).values({
      targetType: 'article',
      targetId: article!.id,
      revisionId: revision!.id,
      operation: 'create',
      idempotencyKey: `test:${article!.id}:${revision!.id}:create`,
      targetPath: serialized.path,
      expectedSha256: serialized.sha256
    })
    return {
      articleId: article!.id,
      revisionId: revision!.id,
      revisionNumber: revision!.revisionNumber,
      collection,
      relativePath,
      source,
      body: revision!.body,
      frontmatter: revision!.frontmatter,
      createdAt: revision!.createdAt,
      serialized
    }
  }

  const seedRepository = async (items: SeededArticle[]) => {
    const seed = join(root, 'seed')
    await git(['init', '--initial-branch=main', seed])
    await git(['config', 'user.name', 'Phase 6 Seed'], seed)
    await git(['config', 'user.email', 'phase6-seed@example.invalid'], seed)
    for (const item of items) {
      const path = join(seed, 'content', item.collection, item.relativePath)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, item.source)
    }
    const memberPath = join(seed, 'content', 'members', 'keep.md')
    await mkdir(dirname(memberPath), { recursive: true })
    await writeFile(memberPath, '---\nid: keep\nname: Keep\n---\n')
    await git(['add', '.'], seed)
    await git(['commit', '-m', 'initial copied content'], seed)
    await git(['init', '--bare', remote])
    await git(['remote', 'add', 'origin', remote], seed)
    await git(['push', '--set-upstream', 'origin', 'main'], seed)
    return git(['rev-parse', 'HEAD'], seed)
  }

  const remoteHead = () => git(['--git-dir', remote, 'rev-parse', 'main'])
  const remotePaths = async () => {
    const output = await git([
      '--git-dir',
      remote,
      'ls-tree',
      '-r',
      '--name-only',
      'main'
    ])
    return output ? output.split('\n') : []
  }
  const remoteFile = (path: string) =>
    gitBytes(['--git-dir', remote, 'show', `main:${path}`])

  const takeOver = async (items: SeededArticle[]) => {
    const initialCommit = await seedRepository(items)
    configureEnvironment('dry_run')
    const report = await runContentTakeoverDryRun()
    configureEnvironment('enabled')
    const result = await applyContentTakeover(contentTakeoverConfirmation(report))
    return { initialCommit, report, result }
  }

  const appendRevision = async (
    item: SeededArticle,
    body: string,
    options: {
      relativePath?: string
      operation?: 'update' | 'move'
      previousPath?: string
    } = {}
  ) => {
    const relativePath = options.relativePath || item.relativePath
    const frontmatter = {
      ...item.frontmatter,
      updatedAt: `2026-01-01T00:00:0${item.revisionNumber}.000Z`
    }
    const source = writeCmsMarkdown(frontmatter, body)
    const parsed = parseCmsMarkdown(source)
    const createdAt = new Date(`2026-01-01T00:00:0${item.revisionNumber}.000Z`)
    const [revision] = await getDatabase().insert(articleRevisions).values({
      articleId: item.articleId,
      revisionNumber: item.revisionNumber + 1,
      markdownSource: source,
      body: parsed.body,
      frontmatter: parsed.frontmatter,
      contentHash: sha256(source),
      sourceKind: 'publish',
      createdAt
    }).returning()
    await getDatabase().update(articles).set({
      relativePath,
      publicPath: `/${item.collection}/${relativePath.replace(/\.md$/, '')}`,
      frontmatter: parsed.frontmatter,
      title: String(parsed.frontmatter.title),
      searchText: body.toLowerCase(),
      contentHash: sha256(source),
      currentRevisionId: revision!.id,
      isPresent: 'true',
      deletedAt: null,
      updatedAt: createdAt
    }).where(eq(articles.id, item.articleId))
    const serialized = serializeContentRevision({
      articleId: item.articleId,
      collection: item.collection,
      relativePath,
      revisionId: revision!.id,
      revisionNumber: revision!.revisionNumber,
      frontmatter: revision!.frontmatter,
      body: revision!.body,
      revisionCreatedAt: revision!.createdAt
    })
    const operation = options.operation || 'update'
    const [job] = await getDatabase().insert(contentExportJobs).values({
      targetType: 'article',
      targetId: item.articleId,
      revisionId: revision!.id,
      operation,
      idempotencyKey: `test:${item.articleId}:${revision!.id}:${operation}`,
      targetPath: serialized.path,
      previousPath: options.previousPath || null,
      expectedSha256: serialized.sha256
    }).returning()
    return {
      ...item,
      revisionId: revision!.id,
      revisionNumber: revision!.revisionNumber,
      relativePath,
      source,
      body: revision!.body,
      frontmatter: revision!.frontmatter,
      createdAt: revision!.createdAt,
      serialized,
      jobId: job!.id
    }
  }

  beforeAll(async () => {
    await runMigrations()
  })

  beforeEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
    root = await mkdtemp(join(tmpdir(), 'vinci-v2-phase6-test-'))
    remote = join(root, 'remote.git')
    workspace = join(root, 'workspace')
    configureEnvironment('dry_run')
    await getDatabase().execute(`
      truncate table rate_limit_buckets, media_assets, content_export_jobs,
      content_export_runs, article_deletion_events, publish_records, edit_locks,
      review_events, audit_logs, sessions, draft_authors, article_revisions,
      drafts, user_members, user_roles, articles, members, users
      restart identity cascade
    `)
    const [actor] = await getDatabase().insert(users).values({
      account: `phase6actor${randomUUID().replaceAll('-', '').slice(0, 12)}`,
      passwordHash: 'unused'
    }).returning()
    actorUserId = actor!.id
  })

  afterAll(async () => {
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    resetContentExportConfigForTests()
    await closeDatabase()
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('只读 Dry Run 可重复，不改远端、分支、文件、数据库或现有 content/', async () => {
    const items = [
      await seedArticle('news', 'phase6-news.md', '阶段六新闻', '新闻正文\n'),
      await seedArticle('wiki', 'guide/phase6.md', '阶段六 Wiki', 'Wiki 正文\n')
    ]
    const initialCommit = await seedRepository(items)
    const initialTree = await git(['--git-dir', remote, 'rev-parse', 'main^{tree}'])
    configureEnvironment('dry_run')
    const first = await runContentTakeoverDryRun()
    const second = await runContentTakeoverDryRun()
    expect(first).toEqual(second)
    expect(first.baseCommit).toBe(initialCommit)
    expect(first.actions.filter(item => item.action === 'move_and_update')).toHaveLength(2)
    expect(first.preservedFiles).toContain('content/members/keep.md')
    expect(first.conflicts).toEqual([])
    expect(await remoteHead()).toBe(initialCommit)
    expect(await git(['--git-dir', remote, 'rev-parse', 'main^{tree}'])).toBe(initialTree)
    expect(await getDatabase().select().from(contentExportRuns)).toEqual([])
    expect(await remotePaths()).toEqual([
      'content/members/keep.md',
      'content/news/phase6-news.md',
      'content/wiki/guide/phase6.md'
    ])
  })

  it('确认令牌后逐项接管，生成稳定 vinciId、snapshot、manifest 和普通 Commit', async () => {
    const items = [
      await seedArticle('news', 'phase6-news.md', '阶段六新闻', '新闻正文\n'),
      await seedArticle('wiki', 'guide/phase6.md', '阶段六 Wiki', 'Wiki 正文\n')
    ]
    const { initialCommit, result } = await takeOver(items)
    const head = await remoteHead()
    expect(head).toBe(result.commitHash)
    expect(await git(['--git-dir', remote, 'rev-parse', 'main^'])).toBe(initialCommit)
    const paths = await remotePaths()
    expect(paths).toContain('news/phase6-news.md')
    expect(paths).toContain('wiki/guide/phase6.md')
    expect(paths).toContain('.vinci/snapshot.json')
    expect(paths).toContain('manifest.json')
    expect(paths).toContain('README.md')
    expect(paths).toContain('content/members/keep.md')
    expect(paths).not.toContain('content/news/phase6-news.md')
    expect(paths).not.toContain('content/wiki/guide/phase6.md')
    const exported = await remoteFile('news/phase6-news.md')
    expect(exported).toContain(`vinciId: ${items[0]!.articleId}`)
    expect(exported.endsWith('\n')).toBe(true)
    expect(paths.some(path => path.startsWith('.github/workflows/'))).toBe(false)
    const snapshot = JSON.parse(await remoteFile('.vinci/snapshot.json'))
    const manifest = JSON.parse(await remoteFile('manifest.json'))
    expect(snapshot.files).toHaveLength(2)
    expect(manifest.snapshot.sha256).toBe(
      sha256ContentBytes(await remoteFile('.vinci/snapshot.json'))
    )
    const jobs = await getDatabase().select().from(contentExportJobs)
    expect(jobs.every(job => job.status === 'succeeded')).toBe(true)
    expect(new Set(jobs.map(job => job.exportedCommitHash))).toEqual(new Set([head]))

    configureEnvironment('dry_run')
    const repeatReport = await runContentTakeoverDryRun()
    expect(repeatReport.actions.every(action => action.action === 'noop')).toBe(true)
    configureEnvironment('enabled')
    const repeat = await applyContentTakeover(
      contentTakeoverConfirmation(repeatReport)
    )
    expect(repeat.commitHash).toBe(head)
    expect(await remoteHead()).toBe(head)
  })

  it('首次接管与 Worker 共用 advisory lock，忙碌时 fail closed', async () => {
    const item = await seedArticle('news', 'locked.md', 'Locked', 'before\n')
    const initialCommit = await seedRepository([item])
    configureEnvironment('dry_run')
    const report = await runContentTakeoverDryRun()
    configureEnvironment('enabled')
    const client = await getDatabasePool().connect()
    try {
      expect((await client.query<{ acquired: boolean }>(
        'select pg_try_advisory_lock(hashtextextended($1, 0)) as acquired',
        ['vinci:v2:content-export-worker']
      )).rows[0]?.acquired).toBe(true)
      await expect(applyContentTakeover(
        contentTakeoverConfirmation(report)
      )).rejects.toThrow('CONTENT_EXPORT_WORKER_BUSY')
      expect(await remoteHead()).toBe(initialCommit)
      expect(await getDatabase().select().from(contentExportRuns)).toEqual([])
    } finally {
      await client.query(
        'select pg_advisory_unlock(hashtextextended($1, 0))',
        ['vinci:v2:content-export-worker']
      )
      client.release()
    }
  })

  it('批量合并新增修改且重复领取幂等，不产生空 Commit', async () => {
    const first = await seedArticle('news', 'batch-a.md', 'Batch A', 'A1\n')
    const second = await seedArticle('wiki', 'batch-b.md', 'Batch B', 'B1\n')
    await takeOver([first, second])
    const before = await remoteHead()
    const nextFirst = await appendRevision(first, 'A2\n')
    const nextSecond = await appendRevision(second, 'B2\n')
    const created = await seedArticle('news', 'batch-c.md', 'Batch C', 'C1\n')
    const result = await runContentExportWorkerOnce()
    expect(result.state).toBe('succeeded')
    expect(result.jobCount).toBe(3)
    expect(result.commitHash).not.toBe(before)
    const jobs = await getDatabase().select().from(contentExportJobs).where(
      inArray(contentExportJobs.id, [
        nextFirst.jobId,
        nextSecond.jobId,
        (await getDatabase().select({ id: contentExportJobs.id })
          .from(contentExportJobs)
          .where(eq(contentExportJobs.targetId, created.articleId))
          .limit(1))[0]!.id
      ])
    )
    expect(jobs.every(job => job.status === 'succeeded')).toBe(true)
    expect(new Set(jobs.map(job => job.exportedCommitHash))).toEqual(
      new Set([result.commitHash])
    )
    const repeat = await runContentExportWorkerOnce()
    expect(repeat.state).toBe('idle')
    expect(await remoteHead()).toBe(result.commitHash)
    expect(await remoteFile('news/batch-a.md')).toContain('A2')
    expect(await remoteFile('wiki/batch-b.md')).toContain('B2')
    expect(await remoteFile('news/batch-c.md')).toContain('C1')
  })

  it('移动和删除只触及受控文章路径，并更新 snapshot tombstone', async () => {
    const item = await seedArticle('wiki', 'old/location.md', 'Move me', 'before\n')
    await takeOver([item])
    const moved = await appendRevision(item, 'after move\n', {
      relativePath: 'new/location.md',
      operation: 'move',
      previousPath: 'wiki/old/location.md'
    })
    expect((await runContentExportWorkerOnce()).state).toBe('succeeded')
    expect(await remotePaths()).not.toContain('wiki/old/location.md')
    expect(await remotePaths()).toContain('wiki/new/location.md')

    await getDatabase().update(articles).set({
      isPresent: 'false',
      deletedAt: new Date('2026-01-02T00:00:00.000Z')
    }).where(eq(articles.id, moved.articleId))
    const [deleteJob] = await getDatabase().insert(contentExportJobs).values({
      targetType: 'article',
      targetId: moved.articleId,
      revisionId: moved.revisionId,
      operation: 'delete',
      idempotencyKey: `test:${moved.articleId}:${moved.revisionId}:delete`,
      targetPath: moved.serialized.path,
      previousPath: moved.serialized.path,
      expectedSha256: moved.serialized.sha256
    }).returning()
    expect((await runContentExportWorkerOnce()).state).toBe('succeeded')
    expect(await remotePaths()).not.toContain('wiki/new/location.md')
    expect(await remotePaths()).toContain('content/members/keep.md')
    const snapshot = JSON.parse(await remoteFile('.vinci/snapshot.json'))
    expect(snapshot.files).toEqual([])
    expect(snapshot.tombstones[0].articleId).toBe(moved.articleId)
    expect((await getDatabase().select().from(contentExportJobs).where(
      eq(contentExportJobs.id, deleteJob!.id)
    ))[0]?.status).toBe('succeeded')
  })

  it('Push 失败指数退避且不回滚数据库；修复远端后继续成功并遮盖凭据', async () => {
    const item = await seedArticle('news', 'retry.md', 'Retry', 'before\n')
    await takeOver([item])
    const next = await appendRevision(item, 'database remains published\n')
    const hook = join(remote, 'hooks', 'pre-receive')
    const secret = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890'
    await writeFile(hook, `#!/bin/sh\necho '${secret}' >&2\nexit 1\n`)
    await chmod(hook, 0o755)
    const failed = await runContentExportWorkerOnce()
    expect(failed.state).toBe('failed')
    expect(failed.retrying).toBe(1)
    const [job] = await getDatabase().select().from(contentExportJobs).where(
      eq(contentExportJobs.id, next.jobId)
    )
    expect(job?.status).toBe('pending')
    expect(job?.attemptCount).toBe(1)
    expect(job?.lastError).not.toContain(secret)
    expect(job?.lastError).toContain('[REDACTED_GITHUB_TOKEN]')
    const [article] = await getDatabase().select().from(articles).where(
      eq(articles.id, next.articleId)
    )
    expect(article?.currentRevisionId).toBe(next.revisionId)
    expect(await remoteFile('news/retry.md')).toContain('before')
    expect(await git(['status', '--porcelain=v1'], workspace)).toBe('')

    await rm(hook)
    await getDatabase().update(contentExportJobs).set({
      nextAttemptAt: new Date(0)
    }).where(eq(contentExportJobs.id, next.jobId))
    const recovered = await runContentExportWorkerOnce()
    expect(recovered.state).toBe('succeeded')
    expect(await remoteFile('news/retry.md')).toContain('database remains published')
  })

  it('Worker 崩溃后的过期租约关闭旧 run，并由新 run 安全恢复', async () => {
    const item = await seedArticle('news', 'expired-lease.md', 'Lease', 'before\n')
    await takeOver([item])
    const next = await appendRevision(item, 'after lease recovery\n')
    const expiredRunId = randomUUID()
    await getDatabase().insert(contentExportRuns).values({
      id: expiredRunId,
      trigger: 'worker',
      status: 'processing',
      workerId: 'crashed-worker',
      jobCount: 1
    })
    await getDatabase().update(contentExportJobs).set({
      status: 'processing',
      attemptCount: 1,
      leaseOwner: 'crashed-worker',
      leaseExpiresAt: new Date(0),
      latestRunId: expiredRunId
    }).where(eq(contentExportJobs.id, next.jobId))

    const recovered = await runContentExportWorkerOnce()
    expect(recovered.state).toBe('succeeded')
    const [oldRun] = await getDatabase().select().from(contentExportRuns).where(
      eq(contentExportRuns.id, expiredRunId)
    )
    expect(oldRun?.status).toBe('failed')
    expect(oldRun?.errorCode).toBe('CONTENT_EXPORT_LEASE_EXPIRED')
    expect(oldRun?.completedAt).not.toBeNull()
    const [job] = await getDatabase().select().from(contentExportJobs).where(
      eq(contentExportJobs.id, next.jobId)
    )
    expect(job?.status).toBe('succeeded')
    expect(job?.attemptCount).toBe(2)
    expect(await remoteFile('news/expired-lease.md')).toContain(
      'after lease recovery'
    )
  })

  it('达到上限进入人工处理，管理员重试后恢复；CMS 状态和一致性报告同步', async () => {
    const item = await seedArticle('news', 'manual-retry.md', 'Manual', 'before\n')
    await takeOver([item])
    const next = await appendRevision(item, 'after\n')
    process.env.CONTENT_EXPORT_MAX_ATTEMPTS = '1'
    resetContentExportConfigForTests()
    const hook = join(remote, 'hooks', 'pre-receive')
    await writeFile(hook, '#!/bin/sh\nexit 1\n')
    await chmod(hook, 0o755)
    const failed = await runContentExportWorkerOnce()
    expect(failed.failed).toBe(1)
    const status = await getCmsArticleExportStatus(
      next.articleId,
      next.revisionId,
      true
    )
    expect(status.state).toBe('export_failed')
    expect(status.canRetry).toBe(true)

    const retried = await retryContentExportJob(next.jobId, actorUserId)
    expect(retried.status).toBe('pending')
    expect(retried.attemptCount).toBe(0)
    expect(retried.previousAttemptCount).toBe(1)
    expect((await getDatabase().select().from(auditLogs).where(and(
      eq(auditLogs.action, 'content_export.retry'),
      eq(auditLogs.targetId, next.jobId)
    ))).length).toBe(1)
    await rm(hook)
    const recovered = await runContentExportWorkerOnce()
    expect(recovered.state).toBe('succeeded')
    const recoveredStatus = await getCmsArticleExportStatus(
      next.articleId,
      next.revisionId,
      true
    )
    expect(recoveredStatus.state).toBe('synchronized')
    expect(recoveredStatus.currentJobNextAttemptAt).toBeNull()
    expect(recoveredStatus.latestExportedCommitHash).toBe(recovered.commitHash)
    const consistency = await checkContentExportConsistency()
    expect(consistency.issueCount).toBe(0)
    expect(consistency.repository.head).toBe(await remoteHead())
  })

  it('序列化字节确定、字段顺序固定、路径与配置边界 fail closed', async () => {
    const articleId = randomUUID()
    const revisionId = randomUUID()
    const input = {
      articleId,
      collection: 'news' as const,
      relativePath: 'deterministic.md',
      revisionId,
      revisionNumber: 1,
      frontmatter: {
        zUnknown: { z: 1, a: 2 },
        title: 'Deterministic',
        aUnknown: 'true',
        tags: ['a', 'b']
      },
      body: 'line 1\r\nline 2\r\n\r\n',
      revisionCreatedAt: new Date('2026-01-01T00:00:00.000Z')
    }
    const first = serializeContentRevision(input)
    const second = serializeContentRevision(input)
    expect(first).toEqual(second)
    expect(first.sha256).toBe(sha256ContentBytes(first.source))
    expect(first.source.endsWith('\n\n')).toBe(false)
    expect(first.source.indexOf('vinciId:')).toBeLessThan(first.source.indexOf('title:'))
    expect(first.source.indexOf('title:')).toBeLessThan(first.source.indexOf('tags:'))
    expect(first.source.indexOf('aUnknown:')).toBeLessThan(first.source.indexOf('zUnknown:'))

    process.env.CONTENT_EXPORT_TEST_MODE = 'false'
    process.env.CONTENT_EXPORT_REMOTE_URL = join(root, 'not-official.git')
    resetContentExportConfigForTests()
    await expect(runContentTakeoverDryRun()).rejects.toThrow(
      '唯一正式仓库'
    )
    process.env.NODE_ENV = 'production'
    process.env.CONTENT_EXPORT_MODE = 'enabled'
    process.env.CONTENT_EXPORT_REMOTE_URL =
      'git@github.com:SDUTVINCI/sdutvinci_content.git'
    process.env.CONTENT_EXPORT_SSH_KEY_FILE = 'relative-key'
    process.env.CONTENT_EXPORT_KNOWN_HOSTS_FILE = 'relative-known-hosts'
    resetContentExportConfigForTests()
    expect(() => getContentExportConfig()).toThrow('独立 SSH key')
    expect(() => serializeContentRevision({
      ...input,
      relativePath: '../../escape.md'
    })).toThrow('CONTENT_EXPORT_PATH_INVALID')
  })
})
