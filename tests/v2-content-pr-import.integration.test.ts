import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { count, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, getDatabase } from '../server/db/client'
import { runMigrations } from '../server/db/migrate'
import {
  articleRevisions,
  articles,
  auditLogs,
  contentPrExternalActions,
  contentPrImportItems,
  contentPrImportRuns,
  drafts,
  reviewEvents,
  users
} from '../server/db/schema'
import {
  canUseContentPrImport,
  ContentPrImportError,
  dryRunContentPrImport,
  executeContentPrExternalAction,
  getContentPrImportArtifact,
  importContentPrItems
} from '../server/services/content-pr-import'
import {
  ContentImportGitHubClient,
  ContentImportGitHubError,
  type GitHubPullFile,
  type GitHubPullRequest
} from '../server/services/content-import-github'
import { mergeMarkdownThreeWay } from '../server/services/content-import-merge'
import { publishCmsDraftDatabase } from '../server/services/cms-publishing-database'
import { getPublicArticleFromDatabase } from '../server/services/public-content'
import {
  buildContentRepositoryMetadata,
  serializeContentRevision
} from '../server/services/content-export-serialization'
import { writeCmsMarkdown } from '../server/utils/cms-frontmatter'
import { resetContentImportConfigForTests } from '../server/utils/content-import-config'
import { configureCmsTestDatabase } from './helpers/cms-test-database'

const enabled = configureCmsTestDatabase()
const suite = enabled ? describe : describe.skip
const BASE = '1'.repeat(40)
const HEAD = '2'.repeat(40)
const execFileAsync = promisify(execFile)

interface SeedArticle {
  articleId: string
  baseRevisionId: string
  currentRevisionId: string
  path: string
  baseSource: string
  currentSource: string
  snapshotFile: {
    articleId: string
    revisionId: string
    revisionNumber: number
    collection: 'wiki'
    relativePath: string
    path: string
    sha256: string
    bytes: number
  }
}

class FakeGitHub {
  pull: GitHubPullRequest = {
    number: 8,
    state: 'open',
    user: { login: 'phase8-proposer' },
    base: { sha: BASE, ref: 'main', repo: { full_name: 'SDUTVINCI/sdutvinci_content' } },
    head: { sha: HEAD, repo: { full_name: 'SDUTVINCI/sdutvinci_content' } }
  }
  files: GitHubPullFile[] = []
  contents = new Map<string, string>()
  comments: string[] = []
  closed = 0
  getPullRequest = async () => this.pull
  listPullFiles = async () => this.files
  readFile = async (_repository: string, path: string, commit: string) => {
    const value = this.contents.get(`${commit}:${path}`)
    if (value === undefined) throw new Error('fixture missing')
    return value
  }
  comment = async (_repository: string, _number: number, body: string) => {
    this.comments.push(body)
    return { id: this.comments.length }
  }
  close = async () => {
    this.closed += 1
    return { state: 'closed' }
  }
}

suite('V2 阶段 8 本地 Markdown PR 导入与三方冲突', () => {
  const originalEnvironment = { ...process.env }
  let actorUserId = ''

  const truncate = () => getDatabase().execute(`
    truncate table rate_limit_buckets, media_assets, content_pr_external_actions,
    content_pr_import_items, content_pr_import_runs, content_import_items,
    content_import_runs, content_reconciliation_runs, content_export_jobs,
    content_export_runs, article_redirects, article_deletion_events,
    publish_records, edit_locks, review_events, audit_logs, sessions,
    draft_authors, article_revisions, drafts, user_members, user_roles,
    articles, members, users restart identity cascade
  `)

  const configure = () => {
    process.env.NODE_ENV = 'test'
    process.env.CONTENT_PR_IMPORT_MODE = 'enabled'
    process.env.CONTENT_PR_IMPORT_REPOSITORY_ID = 'SDUTVINCI/sdutvinci_content'
    process.env.CONTENT_PR_IMPORT_API_URL = 'http://127.0.0.1:9'
    process.env.CONTENT_PR_IMPORT_TEST_MODE = 'true'
    process.env.CONTENT_PR_IMPORT_MAX_FILE_BYTES = '1048576'
    process.env.CONTENT_PR_IMPORT_MAX_FILES = '200'
    process.env.CONTENT_PR_IMPORT_RETRY_ATTEMPTS = '3'
    process.env.CONTENT_PR_IMPORT_ROLE_CODES = 'content_importer'
    delete process.env.CONTENT_PR_IMPORT_GITHUB_TOKEN
    resetContentImportConfigForTests()
  }

  const seedArticle = async (
    relativePath: string,
    baseBody: string,
    currentBody = baseBody
  ): Promise<SeedArticle> => {
    const articleId = randomUUID()
    const baseRevisionId = randomUUID()
    const baseFrontmatter = {
      title: relativePath.replace(/\.md$/, ''),
      authors: [],
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
    const baseMarkdown = writeCmsMarkdown(baseFrontmatter, baseBody)
    const baseSerialized = serializeContentRevision({
      articleId,
      collection: 'wiki',
      relativePath,
      revisionId: baseRevisionId,
      revisionNumber: 1,
      frontmatter: baseFrontmatter,
      body: baseBody,
      revisionCreatedAt: new Date('2026-01-01T00:00:00.000Z')
    })
    await getDatabase().insert(articles).values({
      id: articleId,
      collection: 'wiki',
      relativePath,
      publicPath: `/wiki/${relativePath.replace(/\.md$/, '')}`,
      directory: dirname(relativePath) === '.' ? 'wiki' : `wiki/${dirname(relativePath)}`,
      title: String(baseFrontmatter.title),
      frontmatter: baseFrontmatter,
      searchText: baseBody,
      contentHash: baseSerialized.sha256
    })
    await getDatabase().insert(articleRevisions).values({
      id: baseRevisionId,
      articleId,
      revisionNumber: 1,
      markdownSource: baseMarkdown,
      body: baseBody,
      frontmatter: baseFrontmatter,
      contentHash: baseSerialized.sha256,
      sourceKind: 'backfill',
      createdAt: new Date('2026-01-01T00:00:00.000Z')
    })
    let currentRevisionId = baseRevisionId
    let currentSource = baseSerialized.source
    if (currentBody !== baseBody) {
      currentRevisionId = randomUUID()
      const frontmatter = { ...baseFrontmatter, updatedAt: '2026-02-01T00:00:00.000Z' }
      const markdown = writeCmsMarkdown(frontmatter, currentBody)
      const serialized = serializeContentRevision({
        articleId,
        collection: 'wiki',
        relativePath,
        revisionId: currentRevisionId,
        revisionNumber: 2,
        frontmatter,
        body: currentBody,
        revisionCreatedAt: new Date('2026-02-01T00:00:00.000Z')
      })
      currentSource = serialized.source
      await getDatabase().insert(articleRevisions).values({
        id: currentRevisionId,
        articleId,
        revisionNumber: 2,
        markdownSource: markdown,
        body: currentBody,
        frontmatter,
        contentHash: serialized.sha256,
        sourceKind: 'publish',
        createdAt: new Date('2026-02-01T00:00:00.000Z')
      })
    }
    await getDatabase().update(articles).set({ currentRevisionId }).where(eq(articles.id, articleId))
    return {
      articleId,
      baseRevisionId,
      currentRevisionId,
      path: `wiki/${relativePath}`,
      baseSource: baseSerialized.source,
      currentSource,
      snapshotFile: {
        articleId,
        revisionId: baseRevisionId,
        revisionNumber: 1,
        collection: 'wiki',
        relativePath,
        path: `wiki/${relativePath}`,
        sha256: baseSerialized.sha256,
        bytes: baseSerialized.bytes
      }
    }
  }

  beforeAll(async () => {
    await runMigrations()
  })

  beforeEach(async () => {
    configure()
    await truncate()
    const [actor] = await getDatabase().insert(users).values({
      account: `phaseeight${randomUUID().replaceAll('-', '').slice(0, 12)}`,
      passwordHash: 'unused'
    }).returning({ id: users.id })
    actorUserId = actor!.id
  })

  afterAll(async () => {
    process.env = originalEnvironment
    resetContentImportConfigForTests()
    await closeDatabase()
  })

  it('按段落可靠合并不同区域，并阻止同一段落冲突', () => {
    const base = '标题\n\n第一段原文。\n\n第二段原文。\n'
    const current = '标题\n\n第一段线上修改。\n\n第二段原文。\n'
    const proposed = '标题\n\n第一段原文。\n\n第二段 PR 修改。\n'
    expect(mergeMarkdownThreeWay(base, current, proposed)).toMatchObject({
      merged: '标题\n\n第一段线上修改。\n\n第二段 PR 修改。\n',
      conflicts: []
    })
    const conflict = mergeMarkdownThreeWay(
      base,
      current,
      '标题\n\n第一段 PR 也修改。\n\n第二段原文。\n'
    )
    expect(conflict.merged).toBeNull()
    expect(conflict.conflicts.length).toBeGreaterThan(0)
  })

  it('完整 Dry Run 分类安全/合并/冲突/新增/移动/删除/非法/高风险，并只导入所选安全项且幂等', async () => {
    const safe = await seedArticle('topic/safe.md', '安全原文。\n')
    const merge = await seedArticle(
      'topic/merge.md',
      '第一段原文。\n\n第二段原文。\n',
      '第一段线上修改。\n\n第二段原文。\n'
    )
    const conflict = await seedArticle(
      'topic/conflict.md',
      '同一段原文。\n',
      '同一段线上修改。\n'
    )
    const moved = await seedArticle('topic/old-name.md', '移动正文。\n')
    const deleted = await seedArticle('topic/delete.md', '删除正文。\n')
    const risky = await seedArticle('topic/risky.md', '普通正文。\n')
    const unknown = await seedArticle('topic/unknown.md', '普通正文。\n')
    const untouched = await seedArticle('topic/untouched.md', '不应受影响。\n')
    const all = [safe, merge, conflict, moved, deleted, risky, unknown, untouched]
    const metadata = buildContentRepositoryMetadata(
      all.map(item => item.snapshotFile),
      [],
      new Date('2026-01-01T00:00:00.000Z')
    )
    const fake = new FakeGitHub()
    fake.contents.set(`${BASE}:.vinci/snapshot.json`, metadata.snapshotSource)
    for (const item of all) fake.contents.set(`${BASE}:${item.path}`, item.baseSource)
    const safeProposed = safe.baseSource.replace('安全原文。', '安全 PR 修改。')
    const mergeProposed = merge.baseSource.replace('第二段原文。', '第二段 PR 修改。')
    const conflictProposed = conflict.baseSource.replace('同一段原文。', '同一段 PR 修改。')
    const riskyProposed = risky.baseSource.replace('普通正文。', '<script>alert(1)</script>')
    const unknownProposed = unknown.baseSource.replace('普通正文。', '{{ unknownExtension }}')
    const newSource = writeCmsMarkdown({ title: '数据库分配 ID 的新文章', authors: [] }, '新正文。\n')
    fake.contents.set(`${HEAD}:${safe.path}`, safeProposed)
    fake.contents.set(`${HEAD}:${merge.path}`, mergeProposed)
    fake.contents.set(`${HEAD}:${conflict.path}`, conflictProposed)
    fake.contents.set(`${HEAD}:wiki/topic/new-name.md`, moved.baseSource)
    fake.contents.set(`${HEAD}:wiki/topic/new.md`, newSource)
    fake.contents.set(`${HEAD}:${risky.path}`, riskyProposed)
    fake.contents.set(`${HEAD}:${unknown.path}`, unknownProposed)
    fake.files = [
      { filename: safe.path, status: 'modified', changes: 2 },
      { filename: merge.path, status: 'modified', changes: 2 },
      { filename: conflict.path, status: 'modified', changes: 2 },
      { filename: 'wiki/topic/new.md', status: 'added', changes: 4 },
      { filename: 'wiki/topic/new-name.md', previous_filename: moved.path, status: 'renamed', changes: 0 },
      { filename: deleted.path, status: 'removed', changes: 3 },
      { filename: risky.path, status: 'modified', changes: 2 },
      { filename: unknown.path, status: 'modified', changes: 2 },
      { filename: '../escape.md', status: 'added', changes: 1 }
    ]

    const result = await dryRunContentPrImport(
      actorUserId,
      { repository: 'https://github.com/SDUTVINCI/sdutvinci_content/pull/8', pullRequestNumber: 8 },
      fake as unknown as ContentImportGitHubClient
    )
    expect(result).not.toBeNull()
    const run = result!
    expect(run.items.map(item => item.classification)).toEqual([
      'safe_change', 'auto_merge', 'content_conflict', 'new_article',
      'move_or_rename', 'deletion_proposal', 'high_risk_syntax',
      'unknown_syntax', 'path_conflict'
    ])
    expect(run.items[1]!.mergedSha256).not.toBeNull()
    expect(run.items[2]!.importable).toBe(false)
    expect(run.items[3]!.proposedArticleId).toMatch(/^[0-9a-f-]{36}$/)
    expect(run.items[4]!.conflictDetails).toMatchObject({ redirect: { from: '/wiki/topic/old-name' } })
    expect((await getContentPrImportArtifact(run.id, run.items[1]!.id))?.mergedSource)
      .toContain('第一段线上修改。')
    expect((await getContentPrImportArtifact(run.id, run.items[1]!.id))?.mergedSource)
      .toContain('第二段 PR 修改。')

    const repeated = await dryRunContentPrImport(
      actorUserId,
      { repository: 'SDUTVINCI/sdutvinci_content', pullRequestNumber: 8 },
      fake as unknown as ContentImportGitHubClient
    )
    expect(repeated!.id).toBe(run.id)
    expect((await getDatabase().select({ value: count() }).from(contentPrImportRuns))[0]!.value).toBe(1)

    const selected = run.items.filter(item => item.importable).map(item => item.id)
    const imported = await importContentPrItems(run.id, selected, actorUserId)
    expect(imported.run?.importedCount).toBe(5)
    const draftRows = await getDatabase().select().from(drafts)
    expect(draftRows).toHaveLength(5)
    expect(draftRows.map(row => row.proposedAction).sort()).toEqual(['delete', 'edit', 'edit', 'edit', 'move'])
    expect(draftRows.find(row => !row.articleId)?.proposedArticleId).toBe(run.items[3]!.proposedArticleId)
    expect((await getDatabase().select({ value: count() }).from(articleRevisions))[0]!.value).toBe(10)
    expect((await getDatabase().select({ value: count() }).from(articles))[0]!.value).toBe(8)
    expect((await getDatabase().select().from(articles).where(eq(articles.id, untouched.articleId)))[0]!.currentRevisionId)
      .toBe(untouched.currentRevisionId)

    await importContentPrItems(run.id, selected, actorUserId)
    expect((await getDatabase().select({ value: count() }).from(drafts))[0]!.value).toBe(5)
    expect((await getDatabase().select().from(contentPrImportItems)
      .where(eq(contentPrImportItems.classification, 'content_conflict')))[0]!.status).toBe('pending')
    expect((await getDatabase().select().from(auditLogs)
      .where(eq(auditLogs.action, 'content_pr_import.item_imported')))).toHaveLength(5)
  })

  it('Dry Run 后数据库 Current 再变化会逐项阻止，绝不覆盖新 Revision', async () => {
    const seeded = await seedArticle('stale.md', '基线。\n')
    const metadata = buildContentRepositoryMetadata(
      [seeded.snapshotFile], [], new Date('2026-01-01T00:00:00.000Z')
    )
    const fake = new FakeGitHub()
    fake.contents.set(`${BASE}:.vinci/snapshot.json`, metadata.snapshotSource)
    fake.contents.set(`${BASE}:${seeded.path}`, seeded.baseSource)
    fake.contents.set(`${HEAD}:${seeded.path}`, seeded.baseSource.replace('基线。', 'PR 修改。'))
    fake.files = [{ filename: seeded.path, status: 'modified', changes: 2 }]
    const run = (await dryRunContentPrImport(
      actorUserId,
      { repository: 'SDUTVINCI/sdutvinci_content', pullRequestNumber: 8 },
      fake as unknown as ContentImportGitHubClient
    ))!
    const nextRevisionId = randomUUID()
    await getDatabase().insert(articleRevisions).values({
      id: nextRevisionId,
      articleId: seeded.articleId,
      revisionNumber: 2,
      markdownSource: writeCmsMarkdown({ title: 'stale' }, '后来正式发布。\n'),
      body: '后来正式发布。\n',
      frontmatter: { title: 'stale' },
      contentHash: 'a'.repeat(64),
      sourceKind: 'publish'
    })
    await getDatabase().update(articles).set({ currentRevisionId: nextRevisionId })
      .where(eq(articles.id, seeded.articleId))
    const result = await importContentPrItems(run.id, [run.items[0]!.id], actorUserId)
    expect(result.results[0]).toMatchObject({ blocked: true, draftId: null })
    expect((await getDatabase().select({ value: count() }).from(drafts))[0]!.value).toBe(0)
    expect((await getDatabase().select().from(articles).where(eq(articles.id, seeded.articleId)))[0]!.currentRevisionId)
      .toBe(nextRevisionId)
  })

  it('新增、同目录重命名和删除都只先建提案，人工批准发布后才生效', async () => {
    const moved = await seedArticle('proposal/old.md', '保持 vinciId。\n')
    const deleted = await seedArticle('proposal/delete.md', '等待删除提案。\n')
    const metadata = buildContentRepositoryMetadata(
      [moved.snapshotFile, deleted.snapshotFile], [], new Date('2026-01-01T00:00:00.000Z')
    )
    const fake = new FakeGitHub()
    fake.contents.set(`${BASE}:.vinci/snapshot.json`, metadata.snapshotSource)
    fake.contents.set(`${BASE}:${moved.path}`, moved.baseSource)
    fake.contents.set(`${BASE}:${deleted.path}`, deleted.baseSource)
    fake.contents.set(`${HEAD}:wiki/proposal/renamed.md`, moved.baseSource)
    fake.contents.set(
      `${HEAD}:wiki/proposal/new.md`,
      writeCmsMarkdown({ title: '正式 ID 由数据库预分配', authors: [] }, '新文章。\n')
    )
    fake.files = [
      { filename: 'wiki/proposal/renamed.md', previous_filename: moved.path, status: 'renamed', changes: 0 },
      { filename: 'wiki/proposal/new.md', status: 'added', changes: 3 },
      { filename: deleted.path, status: 'removed', changes: 2 }
    ]
    const run = (await dryRunContentPrImport(
      actorUserId,
      { repository: 'SDUTVINCI/sdutvinci_content', pullRequestNumber: 8 },
      fake as unknown as ContentImportGitHubClient
    ))!
    await importContentPrItems(run.id, run.items.map(item => item.id), actorUserId)
    expect((await getDatabase().select({ value: count() }).from(articles))[0]!.value).toBe(2)
    expect((await getDatabase().select({ value: count() }).from(articleRevisions))[0]!.value).toBe(2)

    const [reviewer] = await getDatabase().insert(users).values({
      account: `phaseeightreviewer${randomUUID().replaceAll('-', '').slice(0, 8)}`,
      passwordHash: 'unused'
    }).returning({ id: users.id })
    const importedDrafts = await getDatabase().select().from(drafts)
    for (const draft of importedDrafts) {
      await getDatabase().update(drafts).set({ status: 'approved' }).where(eq(drafts.id, draft.id))
      await getDatabase().insert(reviewEvents).values({
        draftId: draft.id,
        actorUserId: reviewer!.id,
        action: 'approved',
        fromStatus: 'pending_review',
        toStatus: 'approved'
      })
    }
    const moveDraft = importedDrafts.find(draft => draft.proposedAction === 'move')!
    const newDraft = importedDrafts.find(draft => !draft.articleId)!
    const deleteDraft = importedDrafts.find(draft => draft.proposedAction === 'delete')!
    await publishCmsDraftDatabase(moveDraft.id, actorUserId, { version: moveDraft.version })
    await publishCmsDraftDatabase(newDraft.id, actorUserId, { version: newDraft.version })
    await publishCmsDraftDatabase(deleteDraft.id, actorUserId, { version: deleteDraft.version })

    const movedRow = (await getDatabase().select().from(articles).where(eq(articles.id, moved.articleId)))[0]!
    expect(movedRow.relativePath).toBe('proposal/renamed.md')
    expect((await getPublicArticleFromDatabase('wiki', '/wiki/proposal/old'))?.id).toBe(moved.articleId)
    const created = (await getDatabase().select().from(articles)
      .where(eq(articles.id, newDraft.proposedArticleId!)))[0]!
    expect(created.relativePath).toBe('proposal/new.md')
    const deletedRow = (await getDatabase().select().from(articles).where(eq(articles.id, deleted.articleId)))[0]!
    expect(deletedRow.deletedAt).not.toBeNull()
    expect(deletedRow.isPresent).toBe('false')
  })

  it('仓库和角色边界、外部评论/关闭均显式且只写 mock', async () => {
    expect(canUseContentPrImport(['admin'])).toBe(true)
    expect(canUseContentPrImport(['content_importer'])).toBe(true)
    expect(canUseContentPrImport(['member'])).toBe(false)
    await expect(dryRunContentPrImport(
      actorUserId,
      { repository: 'attacker/other', pullRequestNumber: 8 },
      new FakeGitHub() as unknown as ContentImportGitHubClient
    )).rejects.toMatchObject({ code: 'IMPORT_REPOSITORY_FORBIDDEN' } satisfies Partial<ContentPrImportError>)
    const invalidPull = new FakeGitHub()
    invalidPull.pull = { ...invalidPull.pull, base: { ...invalidPull.pull.base, ref: 'develop' } }
    await expect(dryRunContentPrImport(
      actorUserId,
      { repository: 'SDUTVINCI/sdutvinci_content', pullRequestNumber: 8 },
      invalidPull as unknown as ContentImportGitHubClient
    )).rejects.toMatchObject({ code: 'IMPORT_PULL_REQUEST_INVALID' })

    const seeded = await seedArticle('write-action.md', '基线。\n')
    const metadata = buildContentRepositoryMetadata([seeded.snapshotFile], [], new Date())
    const fake = new FakeGitHub()
    fake.contents.set(`${BASE}:.vinci/snapshot.json`, metadata.snapshotSource)
    fake.contents.set(`${BASE}:${seeded.path}`, seeded.baseSource)
    fake.contents.set(`${HEAD}:${seeded.path}`, seeded.baseSource.replace('基线。', '修改。'))
    fake.files = [{ filename: seeded.path, status: 'modified', changes: 2 }]
    const run = (await dryRunContentPrImport(
      actorUserId,
      { repository: 'SDUTVINCI/sdutvinci_content', pullRequestNumber: 8 },
      fake as unknown as ContentImportGitHubClient
    ))!
    process.env.CONTENT_PR_IMPORT_GITHUB_TOKEN = 'github_pat_phase8_test_only_1234567890'
    resetContentImportConfigForTests()
    await executeContentPrExternalAction(run.id, actorUserId, 'comment', fake as unknown as ContentImportGitHubClient)
    await executeContentPrExternalAction(run.id, actorUserId, 'close', fake as unknown as ContentImportGitHubClient)
    expect(fake.comments).toHaveLength(1)
    expect(fake.comments[0]).not.toContain('基线。')
    expect(fake.comments[0]).toContain('不代表审核、发布或 Merge')
    expect(fake.closed).toBe(1)
    fake.comment = async () => { throw new ContentImportGitHubError('GITHUB_API_FAILED', 503) }
    await expect(executeContentPrExternalAction(
      run.id, actorUserId, 'comment', fake as unknown as ContentImportGitHubClient
    )).rejects.toMatchObject({ code: 'GITHUB_API_FAILED' })
    const actions = await getDatabase().select().from(contentPrExternalActions)
    expect(actions).toHaveLength(3)
    expect(actions.find(action => action.status === 'failed')?.errorCode).toBe('GITHUB_API_FAILED')
  })

  it('异常重复路径 Diff 被逐项标记为路径冲突，Dry Run 仍完整可审计', async () => {
    const seeded = await seedArticle('duplicate.md', '基线。\n')
    const metadata = buildContentRepositoryMetadata([seeded.snapshotFile], [], new Date())
    const fake = new FakeGitHub()
    fake.contents.set(`${BASE}:.vinci/snapshot.json`, metadata.snapshotSource)
    fake.contents.set(`${BASE}:${seeded.path}`, seeded.baseSource)
    fake.contents.set(`${HEAD}:${seeded.path}`, seeded.baseSource.replace('基线。', '修改。'))
    fake.files = [
      { filename: seeded.path, status: 'modified', changes: 1 },
      { filename: seeded.path, status: 'modified', changes: 1 }
    ]
    const run = (await dryRunContentPrImport(
      actorUserId,
      { repository: 'SDUTVINCI/sdutvinci_content', pullRequestNumber: 8 },
      fake as unknown as ContentImportGitHubClient
    ))!
    expect(run.items).toHaveLength(2)
    expect(run.items.every(item => item.classification === 'path_conflict' && !item.importable)).toBe(true)
    expect(run.items.every(item => item.warningCodes.includes('IMPORT_DUPLICATE_PATH_OR_VINCI_ID'))).toBe(true)
  })

  it('GitHub mock 覆盖 5xx 重试、分页、评论和关闭，且没有 Merge 调用', async () => {
    let pageOneAttempts = 0
    const calls: string[] = []
    const files = Array.from({ length: 101 }, (_, index) => ({
      filename: `wiki/${index}.md`, status: 'modified', changes: 1
    }))
    const mockFetch: typeof fetch = async (input, init) => {
      const url = String(input)
      calls.push(`${init?.method || 'GET'} ${url}`)
      const page = new URL(url).searchParams.get('page')
      if (url.includes('/files?') && page === '1') {
        pageOneAttempts += 1
        if (pageOneAttempts === 1) return new Response('{}', { status: 500 })
        return Response.json(files.slice(0, 100))
      }
      if (url.includes('/files?') && page === '2') return Response.json(files.slice(100))
      if (url.includes('/issues/') && init?.method === 'POST') return Response.json({ id: 8 })
      if (url.includes('/pulls/') && init?.method === 'PATCH') return Response.json({ state: 'closed' })
      return new Response('{}', { status: 404 })
    }
    const client = new ContentImportGitHubClient({
      CONTENT_PR_IMPORT_MODE: 'enabled',
      CONTENT_PR_IMPORT_REPOSITORY_ID: 'SDUTVINCI/sdutvinci_content',
      CONTENT_PR_IMPORT_API_URL: 'http://mock.test',
      CONTENT_PR_IMPORT_GITHUB_TOKEN: 'test-token',
      CONTENT_PR_IMPORT_ROLE_CODES: 'content_importer',
      CONTENT_PR_IMPORT_MAX_FILE_BYTES: 1024,
      CONTENT_PR_IMPORT_MAX_FILES: 200,
      CONTENT_PR_IMPORT_RETRY_ATTEMPTS: 3,
      CONTENT_PR_IMPORT_TEST_MODE: 'true',
      authorizedRoles: ['content_importer'],
      testMode: true
    }, mockFetch)
    expect(await client.listPullFiles('SDUTVINCI/sdutvinci_content', 8)).toHaveLength(101)
    await client.comment('SDUTVINCI/sdutvinci_content', 8, 'safe summary')
    await client.close('SDUTVINCI/sdutvinci_content', 8)
    expect(pageOneAttempts).toBe(2)
    expect(calls.some(call => call.includes('/merges'))).toBe(false)
  })

  it('GitHub 文件读取拒绝符号链接、超大文件、二进制、非法 UTF-8 与非法 base64', async () => {
    const responseFor = (path: string) => {
      if (path.includes('symlink.md')) return { type: 'symlink', size: 4, encoding: 'base64', content: 'dGVzdA==' }
      if (path.includes('large.md')) return { type: 'file', size: 1025, encoding: 'base64', content: 'YQ==' }
      if (path.includes('binary.md')) return { type: 'file', size: 3, encoding: 'base64', content: 'YQBi' }
      if (path.includes('utf8.md')) return { type: 'file', size: 1, encoding: 'base64', content: '/w==' }
      return { type: 'file', size: 3, encoding: 'base64', content: '***' }
    }
    const client = new ContentImportGitHubClient({
      CONTENT_PR_IMPORT_MODE: 'enabled',
      CONTENT_PR_IMPORT_REPOSITORY_ID: 'SDUTVINCI/sdutvinci_content',
      CONTENT_PR_IMPORT_API_URL: 'http://mock.test',
      CONTENT_PR_IMPORT_GITHUB_TOKEN: undefined,
      CONTENT_PR_IMPORT_ROLE_CODES: 'content_importer',
      CONTENT_PR_IMPORT_MAX_FILE_BYTES: 1024,
      CONTENT_PR_IMPORT_MAX_FILES: 200,
      CONTENT_PR_IMPORT_RETRY_ATTEMPTS: 1,
      CONTENT_PR_IMPORT_TEST_MODE: 'true',
      authorizedRoles: ['content_importer'],
      testMode: true
    }, async input => Response.json(responseFor(String(input))))
    await expect(client.readFile('SDUTVINCI/sdutvinci_content', 'wiki/symlink.md', BASE))
      .rejects.toMatchObject({ code: 'GITHUB_FILE_UNSAFE' })
    await expect(client.readFile('SDUTVINCI/sdutvinci_content', 'wiki/large.md', BASE))
      .rejects.toMatchObject({ code: 'GITHUB_FILE_TOO_LARGE' })
    await expect(client.readFile('SDUTVINCI/sdutvinci_content', 'wiki/binary.md', BASE))
      .rejects.toMatchObject({ code: 'GITHUB_FILE_BINARY' })
    await expect(client.readFile('SDUTVINCI/sdutvinci_content', 'wiki/utf8.md', BASE))
      .rejects.toMatchObject({ code: 'GITHUB_FILE_ENCODING_INVALID' })
    await expect(client.readFile('SDUTVINCI/sdutvinci_content', 'wiki/base64.md', BASE))
      .rejects.toMatchObject({ code: 'GITHUB_FILE_ENCODING_INVALID' })
    await expect(client.getPullRequest('SDUTVINCI/sdutvinci_content', 8))
      .rejects.toMatchObject({ code: 'GITHUB_RESPONSE_INVALID' })
  })

  it('本地裸 Git 远端构造隔离 PR fixture，Base/Head Diff 不把工作目录当最终状态', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vinci-v2-phase8-git-fixture-'))
    const workspace = join(root, 'workspace')
    const remote = join(root, 'content.git')
    try {
      await mkdir(workspace)
      await execFileAsync('git', ['init', '--bare', remote])
      await execFileAsync('git', ['init', '-b', 'main'], { cwd: workspace })
      await execFileAsync('git', ['config', 'user.name', 'Vinci Phase 8 Fixture'], { cwd: workspace })
      await execFileAsync('git', ['config', 'user.email', 'phase8-fixture@example.invalid'], { cwd: workspace })
      await mkdir(join(workspace, 'wiki'))
      await writeFile(join(workspace, 'wiki', 'fixture.md'), 'base\n', 'utf8')
      await execFileAsync('git', ['add', 'wiki/fixture.md'], { cwd: workspace })
      await execFileAsync('git', ['commit', '-m', 'fixture base'], { cwd: workspace })
      const { stdout: baseOutput } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: workspace })
      await execFileAsync('git', ['remote', 'add', 'origin', remote], { cwd: workspace })
      await execFileAsync('git', ['push', 'origin', 'main'], { cwd: workspace })
      await execFileAsync('git', ['switch', '-c', 'proposal/phase8'], { cwd: workspace })
      await writeFile(join(workspace, 'wiki', 'fixture.md'), 'proposed\n', 'utf8')
      await execFileAsync('git', ['add', 'wiki/fixture.md'], { cwd: workspace })
      await execFileAsync('git', ['commit', '-m', 'fixture proposed'], { cwd: workspace })
      const { stdout: headOutput } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: workspace })
      await execFileAsync('git', ['push', 'origin', 'HEAD:refs/heads/proposal/phase8'], { cwd: workspace })
      await writeFile(join(workspace, 'wiki', 'fixture.md'), 'uncommitted local state must be ignored\n', 'utf8')
      const base = baseOutput.trim()
      const head = headOutput.trim()
      const { stdout: baseSource } = await execFileAsync('git', [`--git-dir=${remote}`, 'show', `${base}:wiki/fixture.md`])
      const { stdout: headSource } = await execFileAsync('git', [`--git-dir=${remote}`, 'show', `${head}:wiki/fixture.md`])
      const { stdout: changed } = await execFileAsync('git', [`--git-dir=${remote}`, 'diff', '--name-only', base, head])
      expect(baseSource).toBe('base\n')
      expect(headSource).toBe('proposed\n')
      expect(changed.trim()).toBe('wiki/fixture.md')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('CMS 入口、关闭权限和审计材料保持脱敏', async () => {
    const [page, closeApi, artifactApi] = await Promise.all([
      readFile(resolve('app/pages/cms/content-imports/index.vue'), 'utf8'),
      readFile(resolve('server/api/cms/content-imports/[id]/close.post.ts'), 'utf8'),
      readFile(resolve('server/services/content-pr-import.ts'), 'utf8')
    ])
    expect(page).toContain('只导入所选安全项目')
    expect(page).toContain('不会批准、发布、Merge')
    expect(page).toContain('Base Source（PR 分支起点内容）')
    expect(page).toContain('Current Source（数据库当前正式内容）')
    expect(page).toContain('Proposed Source（PR 提议的新内容）')
    expect(page).toContain('Merge Result（三方合并后的草稿候选）')
    expect(closeApi).toContain("roles.includes('admin')")
    expect(artifactApi).toContain('redactCmsSensitiveText')
    expect(artifactApi).not.toContain('mergePullRequest')
  })
})
