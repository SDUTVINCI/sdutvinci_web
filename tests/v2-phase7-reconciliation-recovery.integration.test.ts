import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { count, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, getDatabase, getDatabasePool } from '../server/db/client'
import { runMigrations } from '../server/db/migrate'
import {
  articles,
  articleRevisions,
  auditLogs,
  contentImportItems,
  contentImportRuns,
  contentReconciliationRequests,
  contentReconciliationRuns,
  users
} from '../server/db/schema'
import {
  getLatestContentReconciliation,
  runContentReconciliation
} from '../server/services/content-reconciliation'
import {
  requestContentReconciliation,
  runNextRequestedContentReconciliation
} from '../server/services/content-reconciliation-requests'
import {
  applyContentRecovery,
  dryRunContentRecovery
} from '../server/services/content-recovery'
import {
  buildContentRepositoryMetadata,
  CONTENT_REPOSITORY_README,
  serializeContentRevision,
  sha256ContentBytes
} from '../server/services/content-export-serialization'
import { CONTENT_EXPORT_LOCK_NAME } from '../server/services/content-export-worker'
import { getCmsDashboardStats } from '../server/services/cms-dashboard'
import { resetContentExportConfigForTests } from '../server/utils/content-export-config'
import { resetContentRecoveryConfigForTests } from '../server/utils/content-recovery-config'
import { configureCmsTestDatabase } from './helpers/cms-test-database'

const enabled = configureCmsTestDatabase()
const suite = enabled ? describe : describe.skip
const runFile = promisify(execFile)

suite('V2 阶段 7 全量对账、空库初始化和灾难恢复', () => {
  let root = ''
  let remote = ''
  let workspace = ''
  let maintenanceRoot = ''
  const originalEnvironment = { ...process.env }

  const git = async (args: string[], cwd?: string) =>
    (await runFile('git', args, { cwd })).stdout.trim()

  const configureEnvironment = () => {
    process.env.NODE_ENV = 'test'
    process.env.CONTENT_REPOSITORY_ID = 'SDUTVINCI/sdutvinci_content'
    process.env.CONTENT_EXPORT_MODE = 'enabled'
    process.env.CONTENT_EXPORT_TEST_MODE = 'true'
    process.env.CONTENT_EXPORT_REMOTE_URL = remote
    process.env.CONTENT_EXPORT_REMOTE = 'origin'
    process.env.CONTENT_EXPORT_BRANCH = 'main'
    process.env.CONTENT_EXPORT_WORKSPACE = workspace
    process.env.CONTENT_EXPORT_AUTHOR_NAME = 'Phase 7 Test'
    process.env.CONTENT_EXPORT_AUTHOR_EMAIL = 'phase7@example.test'
    delete process.env.CONTENT_EXPORT_SSH_KEY_FILE
    delete process.env.CONTENT_EXPORT_KNOWN_HOSTS_FILE
    process.env.CONTENT_RECONCILIATION_ROOT = maintenanceRoot
    process.env.CONTENT_RECOVERY_MODE = 'enabled'
    process.env.CONTENT_RECOVERY_TEST_MODE = 'true'
    resetContentExportConfigForTests()
    resetContentRecoveryConfigForTests()
  }

  const seedArticle = async (relativePath = 'phase7.md') => {
    const articleId = randomUUID()
    const revisionId = randomUUID()
    const frontmatter = { title: '阶段 7 测试' }
    const body = '数据库权威正文\n'
    const createdAt = new Date('2026-07-30T18:00:00.000Z')
    const serialized = serializeContentRevision({
      articleId,
      revisionId,
      revisionNumber: 1,
      collection: 'wiki',
      relativePath,
      frontmatter,
      body,
      revisionCreatedAt: createdAt
    })
    await getDatabase().insert(articles).values({
      id: articleId,
      collection: 'wiki',
      relativePath,
      publicPath: `/wiki/${relativePath.replace(/\.md$/, '')}`,
      directory: dirname(relativePath),
      title: '阶段 7 测试',
      frontmatter,
      searchText: body,
      contentHash: serialized.sha256,
      currentRevisionId: null
    })
    await getDatabase().insert(articleRevisions).values({
      id: revisionId,
      articleId,
      revisionNumber: 1,
      markdownSource: serialized.source,
      body,
      frontmatter,
      contentHash: serialized.sha256,
      sourceKind: 'backfill',
      createdAt
    })
    await getDatabase().update(articles).set({
      currentRevisionId: revisionId
    }).where(eq(articles.id, articleId))
    return {
      articleId,
      revisionId,
      revisionNumber: 1,
      collection: 'wiki' as const,
      relativePath,
      createdAt,
      serialized
    }
  }

  const seedRepository = async (
    items: Array<Awaited<ReturnType<typeof seedArticle>>>
  ) => {
    const seed = join(root, 'seed')
    await mkdir(seed)
    const files = items.map(item => ({
      articleId: item.articleId,
      revisionId: item.revisionId,
      revisionNumber: item.revisionNumber,
      collection: item.collection,
      relativePath: item.relativePath,
      path: item.serialized.path,
      sha256: item.serialized.sha256,
      bytes: item.serialized.bytes
    }))
    const metadata = buildContentRepositoryMetadata(files, [], items[0]?.createdAt || null)
    for (const item of items) {
      const target = join(seed, item.serialized.path)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, item.serialized.source)
    }
    await mkdir(join(seed, '.vinci'))
    await writeFile(join(seed, '.vinci/snapshot.json'), metadata.snapshotSource)
    await writeFile(join(seed, 'manifest.json'), metadata.manifestSource)
    await writeFile(join(seed, 'README.md'), CONTENT_REPOSITORY_README)
    await git(['init', '--initial-branch=main'], seed)
    await git(['config', 'user.name', 'Phase 7 Seed'], seed)
    await git(['config', 'user.email', 'phase7-seed@localhost'], seed)
    await git(['add', '.'], seed)
    await git(['commit', '-m', 'seed database snapshot'], seed)
    await git(['init', '--bare', remote])
    await git(['remote', 'add', 'origin', remote], seed)
    await git(['push', '--set-upstream', 'origin', 'main'], seed)
  }

  const cloneRecoverySource = async () => {
    const source = join(root, `recovery-${randomUUID()}`)
    await git(['clone', '--branch', 'main', remote, source], root)
    return source
  }

  const truncate = () => getDatabase().execute(`
    truncate table rate_limit_buckets, media_assets, content_import_items,
    content_import_runs, content_reconciliation_requests, content_reconciliation_runs, content_export_jobs,
    content_export_runs, article_deletion_events, publish_records, edit_locks,
    review_events, audit_logs, sessions, draft_authors, article_revisions,
    drafts, user_members, user_roles, articles, members, users
    restart identity cascade
  `)

  beforeAll(async () => {
    await runMigrations()
  })

  beforeEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
    root = await mkdtemp(join(tmpdir(), 'vinci-v2-phase7-test-'))
    remote = join(root, 'remote.git')
    workspace = join(root, 'workspace')
    maintenanceRoot = join(root, 'maintenance')
    configureEnvironment()
    await truncate()
  })

  it('管理员请求由常驻 Worker 领取并执行一次全量对账', async () => {
    const item = await seedArticle()
    await seedRepository([item])
    const [admin] = await getDatabase().insert(users).values({
      account: 'phase7admin',
      passwordHash: 'test-only-password-hash'
    }).returning({ id: users.id })
    const first = await requestContentReconciliation(admin!.id)
    const duplicate = await requestContentReconciliation(admin!.id)
    expect(first.created).toBe(true)
    expect(duplicate).toMatchObject({ id: first.id, created: false, status: 'pending' })

    const result = await runNextRequestedContentReconciliation()
    expect(result).toMatchObject({ requestId: first.id, state: 'succeeded', runId: first.id })
    const [request] = await getDatabase().select().from(contentReconciliationRequests)
    expect(request).toMatchObject({ id: first.id, status: 'succeeded' })
    expect((await getDatabase().select().from(contentReconciliationRuns))).toHaveLength(1)
  })

  afterAll(async () => {
    process.env = originalEnvironment
    resetContentExportConfigForTests()
    resetContentRecoveryConfigForTests()
    await closeDatabase()
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('Asia/Shanghai 快照无差异时记录成功但不产生空 Commit，CMS 显示结果', async () => {
    const item = await seedArticle()
    await seedRepository([item])
    const before = await git(['--git-dir', remote, 'rev-parse', 'main'])
    const result = await runContentReconciliation('schedule')
    expect(result.state).toBe('succeeded')
    expect(result.report?.counts.total).toBe(0)
    expect(result.commitHash).toBe(before)
    expect(await git(['--git-dir', remote, 'rev-parse', 'main'])).toBe(before)
    const latest = await getLatestContentReconciliation()
    expect(latest?.status).toBe('succeeded')
    expect(latest?.resultCommitHash).toBe(before)
    expect(await readFile(
      join(maintenanceRoot, 'reports', `${result.runId}.json`),
      'utf8'
    )).toContain('"total": 0')
    expect((await getCmsDashboardStats(randomUUID(), true)).reconciliation)
      .toMatchObject({ status: 'succeeded', differenceCount: 0 })
  })

  it('修正篡改、数据库新增/仓库缺失和多余文件并生成普通非强制 Commit', async () => {
    const first = await seedArticle('first.md')
    const missing = await seedArticle('missing.md')
    await seedRepository([first, missing])
    await runContentReconciliation()
    const before = await git(['--git-dir', remote, 'rev-parse', 'main'])
    const second = await seedArticle('second.md')
    const tamper = join(root, 'tamper')
    await git(['clone', '--branch', 'main', remote, tamper], root)
    await git(['config', 'user.name', 'Tamper'], tamper)
    await git(['config', 'user.email', 'tamper@localhost'], tamper)
    await writeFile(join(tamper, first.serialized.path), 'tampered\n')
    await rm(join(tamper, missing.serialized.path))
    await writeFile(join(tamper, 'wiki/extra.md'), 'extra\n')
    await git(['add', '.'], tamper)
    await git(['commit', '-m', 'tamper repository'], tamper)
    await git(['push', 'origin', 'main'], tamper)
    const tamperedHead = await git(['--git-dir', remote, 'rev-parse', 'main'])

    const result = await runContentReconciliation()
    expect(result.report?.counts.modified).toBe(1)
    expect(result.report?.counts.databaseNew).toBe(1)
    expect(result.report?.counts.repositoryMissing).toBe(1)
    expect(result.report?.counts.extra).toBe(1)
    expect(result.commitHash).not.toBe(before)
    expect(await git(['--git-dir', remote, 'rev-parse', 'main^']))
      .toBe(tamperedHead)
    expect(await git(['--git-dir', remote, 'show', `main:${first.serialized.path}`]))
      .toContain('数据库权威正文')
    expect(await git(['--git-dir', remote, 'show', `main:${second.serialized.path}`]))
      .toContain('数据库权威正文')
    expect(await git(['--git-dir', remote, 'show', `main:${missing.serialized.path}`]))
      .toContain('数据库权威正文')
    await expect(git(['--git-dir', remote, 'show', 'main:wiki/extra.md']))
      .rejects.toThrow()
  })

  it('空数据库面对非空内容仓库时 fail closed，不删除文件、不 Commit 或 Push', async () => {
    const item = await seedArticle('official-content.md')
    await seedRepository([item])
    await truncate()
    const before = await git(['--git-dir', remote, 'rev-parse', 'main'])

    await expect(runContentReconciliation('schedule'))
      .rejects.toThrow('CONTENT_RECONCILIATION_EMPTY_DATABASE_GUARD')

    expect(await git(['--git-dir', remote, 'rev-parse', 'main'])).toBe(before)
    expect(await git([
      '--git-dir',
      remote,
      'show',
      `main:${item.serialized.path}`
    ])).toContain('数据库权威正文')
    expect(await getLatestContentReconciliation()).toMatchObject({
      status: 'failed',
      errorCode: 'CONTENT_RECONCILIATION_EMPTY_DATABASE_GUARD'
    })
  })

  it('与增量 Worker 使用同一个 advisory lock，忙碌时不写仓库', async () => {
    const item = await seedArticle()
    await seedRepository([item])
    const before = await git(['--git-dir', remote, 'rev-parse', 'main'])
    const client = await getDatabasePool().connect()
    try {
      expect((await client.query<{ acquired: boolean }>(
        'select pg_try_advisory_lock(hashtextextended($1, 0)) as acquired',
        [CONTENT_EXPORT_LOCK_NAME]
      )).rows[0]?.acquired).toBe(true)
      const result = await runContentReconciliation()
      expect(result.state).toBe('busy')
      expect(await git(['--git-dir', remote, 'rev-parse', 'main'])).toBe(before)
      expect((await getLatestContentReconciliation())?.status).toBe('busy')
    } finally {
      await client.query(
        'select pg_advisory_unlock(hashtextextended($1, 0))',
        [CONTENT_EXPORT_LOCK_NAME]
      )
      client.release()
    }
  })

  it('Dry Run 校验格式/哈希/令牌，事务失败不留半导入，成功后拒绝非空库', async () => {
    const first = await seedArticle('first.md')
    const second = await seedArticle('second.md')
    await seedRepository([first, second])
    const source = await cloneRecoverySource()
    await truncate()

    const report = await dryRunContentRecovery(
      source,
      'empty_database_initialization',
      'phase7-test-maintainer'
    )
    expect(report.itemCount).toBe(2)
    await expect(applyContentRecovery(
      source,
      'empty_database_initialization',
      'phase7-test-maintainer',
      'wrong-token'
    )).rejects.toThrow('CONTENT_RECOVERY_CONFIRMATION_INVALID')

    process.env.CONTENT_RECOVERY_TEST_FAIL_AFTER_ITEMS = '1'
    await expect(applyContentRecovery(
      source,
      'empty_database_initialization',
      'phase7-test-maintainer',
      report.requiredConfirmation
    )).rejects.toThrow('CONTENT_RECOVERY_INJECTED_TRANSACTION_FAILURE')
    delete process.env.CONTENT_RECOVERY_TEST_FAIL_AFTER_ITEMS
    expect((await getDatabase().select({ value: count() }).from(articles))[0]?.value).toBe(0)
    expect((await getDatabase().select({ value: count() }).from(contentImportRuns))[0]?.value)
      .toBe(0)
    expect((await getDatabase().select({ value: count() }).from(auditLogs))[0]?.value).toBe(0)

    await getDatabase().insert(contentImportRuns).values({
      mode: 'disaster_recovery',
      status: 'failed',
      snapshotSha256: report.snapshotSha256,
      actorLabel: 'old-failed-run'
    })
    await expect(dryRunContentRecovery(
      source,
      'disaster_recovery',
      'phase7-test-maintainer'
    )).rejects.toThrow('CONTENT_RECOVERY_DATABASE_NOT_EMPTY')
    await getDatabase().delete(contentImportItems)
    await getDatabase().delete(contentImportRuns)

    const applied = await applyContentRecovery(
      source,
      'disaster_recovery',
      'phase7-test-maintainer',
      (await dryRunContentRecovery(
        source,
        'disaster_recovery',
        'phase7-test-maintainer'
      )).requiredConfirmation
    )
    expect(applied.status).toBe('succeeded')
    expect((await getDatabase().select({ value: count() }).from(articles))[0]?.value).toBe(2)
    expect((await getDatabase().select({ value: count() }).from(auditLogs))[0]?.value).toBe(1)
    await expect(dryRunContentRecovery(
      source,
      'disaster_recovery',
      'phase7-test-maintainer'
    )).rejects.toThrow('CONTENT_RECOVERY_DATABASE_NOT_EMPTY')
  })

  it('错误 manifest 格式和 Markdown 哈希均 fail closed', async () => {
    const item = await seedArticle()
    await seedRepository([item])
    const badFormat = await cloneRecoverySource()
    const manifestPath = join(badFormat, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.formatVersion = 2
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    await truncate()
    await expect(dryRunContentRecovery(
      badFormat,
      'disaster_recovery',
      'phase7-test-maintainer'
    )).rejects.toThrow('CONTENT_RECOVERY_MANIFEST_INVALID')

    const badHash = await cloneRecoverySource()
    await writeFile(join(badHash, item.serialized.path), 'tampered\n')
    await expect(dryRunContentRecovery(
      badHash,
      'disaster_recovery',
      'phase7-test-maintainer'
    )).rejects.toThrow('CONTENT_RECOVERY_FILE_HASH_MISMATCH')

    const unlisted = await cloneRecoverySource()
    await writeFile(join(unlisted, 'wiki/unlisted.md'), 'unlisted\n')
    await expect(dryRunContentRecovery(
      unlisted,
      'disaster_recovery',
      'phase7-test-maintainer'
    )).rejects.toThrow('CONTENT_RECOVERY_MANAGED_FILE_SET_MISMATCH')

    const badTombstone = await cloneRecoverySource()
    const snapshotPath = join(badTombstone, '.vinci/snapshot.json')
    const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'))
    snapshot.tombstones.push({
      articleId: item.articleId,
      revisionId: item.revisionId,
      collection: item.collection,
      relativePath: item.relativePath,
      path: item.serialized.path
    })
    const snapshotSource = `${JSON.stringify(snapshot, null, 2)}\n`
    await writeFile(snapshotPath, snapshotSource)
    const badTombstoneManifestPath = join(badTombstone, 'manifest.json')
    const badTombstoneManifest = JSON.parse(
      await readFile(badTombstoneManifestPath, 'utf8')
    )
    badTombstoneManifest.snapshot.sha256 = sha256ContentBytes(snapshotSource)
    await writeFile(
      badTombstoneManifestPath,
      `${JSON.stringify(badTombstoneManifest, null, 2)}\n`
    )
    await expect(dryRunContentRecovery(
      badTombstone,
      'disaster_recovery',
      'phase7-test-maintainer'
    )).rejects.toThrow('CONTENT_RECOVERY_TOMBSTONE_INVALID')
  })
})
