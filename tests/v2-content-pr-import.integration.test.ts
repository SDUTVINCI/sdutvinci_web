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
  articleRedirects,
  articles,
  auditLogs,
  contentPrExternalActions,
  contentPrImportItems,
  contentPrImportRuns,
  contentExportJobs,
  draftAuthors,
  drafts,
  memberProposals,
  memberRevisions,
  members,
  reviewEvents,
  users
} from '../server/db/schema'
import {
  canUseContentPrImport,
  ContentPrImportError,
  dryRunContentPrImport,
  executeContentPrExternalAction,
  getContentPrImportRun,
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
import { buildPublishedSource } from '../server/services/cms-publishing-legacy'
import { getCmsArticlePublicPath } from '../server/services/cms-articles'
import {
  CMS_UNMATCHED_AUTHORS_KEY,
  CMS_UNMATCHED_CONTRIBUTORS_KEY
} from '../server/services/cms-drafts'
import { getPublicArticleFromDatabase } from '../server/services/public-content'
import { applyMemberProposal } from '../server/services/cms-members'
import { memberProfileFromMarkdown, profileRecord, serializeMemberProfile } from '../server/services/member-profile'
import {
  buildContentRepositoryMetadata,
  serializeContentRevision
} from '../server/services/content-export-serialization'
import { writeCmsMarkdown } from '../server/utils/cms-frontmatter'
import { resetContentImportConfigForTests } from '../server/utils/content-import-config'
import {
  buildContentImportContext,
  buildContentImportDiff
} from '../shared/utils/content-import-diff'
import { CONTENT_IMPORT_HIGH_RISK_CONFIRMATION } from '../shared/types/cms-content-imports'
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

interface SeedMember {
  memberId: string
  baseRevisionId: string
  currentRevisionId: string
  path: string
  baseSource: string
  snapshotFile: ReturnType<typeof seedMemberSnapshotShape>
}

const seedMemberSnapshotShape = (value: {
  memberId: string, memberKey: string, revisionId: string, revisionNumber: number,
  sourcePath: string, path: string, sha256: string, bytes: number
}) => value

class FakeGitHub {
  pull: GitHubPullRequest = {
    number: 8,
    state: 'open',
    user: { login: 'phase8-proposer' },
    base: { sha: BASE, ref: 'main', repo: { full_name: 'SDUTVINCI/sdutvinci_content' } },
    head: { sha: HEAD, ref: 'phase8-content-change', repo: { full_name: 'SDUTVINCI/sdutvinci_content' } }
  }
  files: GitHubPullFile[] = []
  contents = new Map<string, string>()
  comments: string[] = []
  closed = 0
  branchSha = HEAD
  deletedBranches: string[] = []
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
    this.pull = { ...this.pull, state: 'closed' }
    return { state: 'closed' }
  }
  getBranchReference = async (_repository: string, branch: string) => ({
    ref: `refs/heads/${branch}`,
    object: { sha: this.branchSha, type: 'commit' }
  })
  deleteBranch = async (_repository: string, branch: string) => {
    this.deletedBranches.push(branch)
    return { deleted: true as const }
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
      publicPath: getCmsArticlePublicPath('wiki', relativePath),
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

  const seedMember = async (
    memberKey: string,
    baseSource: string,
    currentTransform?: (source: string) => string
  ): Promise<SeedMember> => {
    const memberId = randomUUID()
    const baseRevisionId = randomUUID()
    const sourcePath = `${memberKey}.md`
    const baseProfile = memberProfileFromMarkdown(baseSource, sourcePath)
    const baseSerialized = serializeMemberProfile(baseProfile)
    await getDatabase().insert(members).values({
      id: memberId, memberKey, name: baseProfile.name, avatarUrl: baseProfile.avatarUrl,
      sourcePath, role: baseProfile.role, memberType: baseProfile.memberType,
      seasons: baseProfile.seasons, advisorSeasons: baseProfile.advisorSeasons,
      grade: baseProfile.grade, affiliation: baseProfile.affiliation, links: baseProfile.links,
      body: baseProfile.body, sortOrder: baseProfile.sortOrder, metadata: baseProfile.metadata
    })
    await getDatabase().insert(memberRevisions).values({
      id: baseRevisionId, memberId, revisionNumber: 1, memberKey, sourcePath,
      profile: profileRecord(baseProfile), markdownSource: baseSerialized.source,
      contentHash: baseSerialized.sha256, sourceKind: 'backfill'
    })
    let currentRevisionId = baseRevisionId
    if (currentTransform) {
      const currentProfile = memberProfileFromMarkdown(currentTransform(baseSerialized.source), sourcePath)
      const currentSerialized = serializeMemberProfile(currentProfile)
      currentRevisionId = randomUUID()
      await getDatabase().insert(memberRevisions).values({
        id: currentRevisionId, memberId, revisionNumber: 2, memberKey, sourcePath,
        profile: profileRecord(currentProfile), markdownSource: currentSerialized.source,
        contentHash: currentSerialized.sha256, sourceKind: 'cms_update'
      })
      await getDatabase().update(members).set({
        role: currentProfile.role, grade: currentProfile.grade, version: 2
      }).where(eq(members.id, memberId))
    }
    await getDatabase().update(members).set({ currentRevisionId }).where(eq(members.id, memberId))
    return {
      memberId, baseRevisionId, currentRevisionId, path: baseSerialized.path,
      baseSource: baseSerialized.source,
      snapshotFile: seedMemberSnapshotShape({
        memberId, memberKey, revisionId: baseRevisionId, revisionNumber: 1,
        sourcePath, path: baseSerialized.path, sha256: baseSerialized.sha256, bytes: baseSerialized.bytes
      })
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

  it('四方材料按 Git diff 行号和增删类型高亮', () => {
    expect(buildContentImportContext('第一行\n第二行\n')).toEqual([
      { kind: 'context', prefix: ' ', text: '第一行', oldLine: 1, newLine: 1 },
      { kind: 'context', prefix: ' ', text: '第二行', oldLine: 2, newLine: 2 }
    ])
    expect(buildContentImportDiff(
      '保留\n旧内容\n',
      '保留\n新内容\n新增行\n'
    )).toEqual([
      { kind: 'context', prefix: ' ', text: '保留', oldLine: 1, newLine: 1 },
      { kind: 'removed', prefix: '-', text: '旧内容', oldLine: 2, newLine: null },
      { kind: 'added', prefix: '+', text: '新内容', oldLine: null, newLine: 2 },
      { kind: 'added', prefix: '+', text: '新增行', oldLine: null, newLine: 3 }
    ])
  })

  it('无法匹配的作者和贡献者仍随 PR 草稿保留，并在发布 Markdown 中恢复', async () => {
    const creditMembers = await getDatabase().insert(members).values([
      { memberKey: 'known-author', name: 'Known Author' },
      { memberKey: 'known-contributor', name: 'Known Contributor' }
    ]).returning({ id: members.id, memberKey: members.memberKey })
    const metadata = buildContentRepositoryMetadata(
      [], [], new Date('2026-01-01T00:00:00.000Z')
    )
    const fake = new FakeGitHub()
    fake.contents.set(`${BASE}:.vinci/snapshot.json`, metadata.snapshotSource)
    fake.contents.set(`${HEAD}:wiki/credits/new.md`, writeCmsMarkdown({
      title: '保留无法匹配署名',
      authors: ['known-author', '外部作者'],
      contributors: ['known-contributor', '外部编辑']
    }, '正文。\n'))
    fake.files = [{ filename: 'wiki/credits/new.md', status: 'added', changes: 8 }]

    const run = (await dryRunContentPrImport(
      actorUserId,
      { repository: 'SDUTVINCI/sdutvinci_content', pullRequestNumber: 8 },
      fake as unknown as ContentImportGitHubClient
    ))!
    const result = await importContentPrItems(run.id, [run.items[0]!.id], actorUserId)
    const draftId = result.results[0]!.draftId!
    const [draft] = await getDatabase().select().from(drafts).where(eq(drafts.id, draftId))
    expect(draft!.preservedFrontmatter).toMatchObject({
      contributors: ['known-contributor'],
      [CMS_UNMATCHED_AUTHORS_KEY]: ['外部作者'],
      [CMS_UNMATCHED_CONTRIBUTORS_KEY]: ['外部编辑']
    })
    const storedAuthors = await getDatabase().select().from(draftAuthors)
      .where(eq(draftAuthors.draftId, draftId))
    expect(storedAuthors.map(row => row.memberId)).toEqual([
      creditMembers.find(member => member.memberKey === 'known-author')!.id
    ])

    const built = buildPublishedSource({
      preservedFrontmatter: draft!.preservedFrontmatter,
      title: draft!.title,
      description: draft!.description,
      authorKeys: ['known-author'],
      body: draft!.body,
      now: new Date('2026-08-12T00:00:00.000Z')
    })
    expect(built.frontmatter.authors).toEqual(['known-author', '外部作者'])
    expect(built.frontmatter.contributors).toEqual(['known-contributor', '外部编辑'])
    expect(built.source).not.toContain(CMS_UNMATCHED_AUTHORS_KEY)
    expect(built.source).not.toContain(CMS_UNMATCHED_CONTRIBUTORS_KEY)
  })

  it('复用已发布历史导入 PR，仅在真正活动草稿存在时阻止并允许原项目重试', async () => {
    const article = await seedArticle('topic/published-history.md', '历史正文。\n')
    const metadata = buildContentRepositoryMetadata(
      [article.snapshotFile], [], new Date('2026-01-01T00:00:00.000Z')
    )
    const fake = new FakeGitHub()
    const proposedSource = article.baseSource.replace('历史正文。', 'PR 新正文。')
    fake.contents.set(`${BASE}:.vinci/snapshot.json`, metadata.snapshotSource)
    fake.contents.set(`${BASE}:${article.path}`, article.baseSource)
    fake.contents.set(`${HEAD}:${article.path}`, proposedSource)
    fake.files = [{ filename: article.path, status: 'modified', changes: 2 }]

    const [publishedHistory] = await getDatabase().insert(drafts).values({
      articleId: article.articleId,
      ownerUserId: actorUserId,
      collection: 'wiki',
      title: '旧的已发布记录',
      body: '旧草稿正文',
      baseContentHash: '0'.repeat(64),
      baseRevisionId: article.currentRevisionId,
      status: 'published',
      version: 7
    }).returning({ id: drafts.id })
    const run = (await dryRunContentPrImport(
      actorUserId,
      { repository: 'SDUTVINCI/sdutvinci_content', pullRequestNumber: 8 },
      fake as unknown as ContentImportGitHubClient
    ))!
    const itemId = run.items[0]!.id

    const imported = await importContentPrItems(run.id, [itemId], actorUserId)
    expect(imported.results[0]).toMatchObject({
      imported: true,
      draftId: publishedHistory!.id
    })
    expect(await getDatabase().select().from(drafts)).toHaveLength(1)
    expect((await getDatabase().select().from(drafts))[0]).toMatchObject({
      id: publishedHistory!.id,
      status: 'draft',
      body: 'PR 新正文。\n',
      baseRevisionId: article.currentRevisionId,
      version: 8
    })
    expect((await getDatabase().select().from(auditLogs)
      .where(eq(auditLogs.action, 'content_pr_import.published_draft_reopened')))).toHaveLength(1)

    await getDatabase().update(contentPrImportItems).set({
      status: 'pending',
      draftId: null,
      importedAt: null
    }).where(eq(contentPrImportItems.id, itemId))
    const blocked = await importContentPrItems(run.id, [itemId], actorUserId)
    expect(blocked.results[0]).toMatchObject({ imported: false, blocked: true })
    const [blockedItem] = await getDatabase().select().from(contentPrImportItems)
      .where(eq(contentPrImportItems.id, itemId))
    expect(blockedItem!.warningCodes).toContain('IMPORT_ACTIVE_DRAFT_EXISTS')
    expect(blockedItem!.conflictDetails).toMatchObject({
      activeDraft: { draftId: publishedHistory!.id, status: 'draft' }
    })

    await getDatabase().update(drafts).set({ status: 'published' })
      .where(eq(drafts.id, publishedHistory!.id))
    const retried = await importContentPrItems(run.id, [itemId], actorUserId)
    expect(retried.results[0]).toMatchObject({
      imported: true,
      draftId: publishedHistory!.id
    })
    const [retriedItem] = await getDatabase().select().from(contentPrImportItems)
      .where(eq(contentPrImportItems.id, itemId))
    expect(retriedItem!.warningCodes).not.toContain('IMPORT_ACTIVE_DRAFT_EXISTS')
    expect(retriedItem!.conflictDetails).not.toHaveProperty('activeDraft')
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

    const safeItem = run.items.find(item => item.classification === 'safe_change')!
    const importedSafeItem = (await getDatabase().select().from(contentPrImportItems)
      .where(eq(contentPrImportItems.id, safeItem.id)))[0]!
    await getDatabase().update(contentPrImportItems).set({ status: 'pending', draftId: null })
      .where(eq(contentPrImportItems.id, safeItem.id))
    expect((await importContentPrItems(run.id, [safeItem.id], actorUserId)).results[0])
      .toMatchObject({ imported: false, blocked: true })
    const blockedExistingDraft = (await getDatabase().select().from(contentPrImportItems)
      .where(eq(contentPrImportItems.id, safeItem.id)))[0]!
    expect(blockedExistingDraft.status).toBe('blocked')
    expect(blockedExistingDraft.warningCodes).toContain('IMPORT_ACTIVE_DRAFT_EXISTS')
    await getDatabase().update(contentPrImportItems).set({
      status: 'imported', draftId: importedSafeItem.draftId,
      warningCodes: blockedExistingDraft.warningCodes.filter(code => code !== 'IMPORT_ACTIVE_DRAFT_EXISTS')
    }).where(eq(contentPrImportItems.id, safeItem.id))

    const highRiskItem = run.items.find(item => item.classification === 'high_risk_syntax')!
    expect((await importContentPrItems(run.id, [highRiskItem.id], actorUserId)).results[0])
      .toMatchObject({ imported: false, blocked: true })
    const conflictItem = run.items.find(item => item.classification === 'content_conflict')!
    await expect(importContentPrItems(run.id, [conflictItem.id], actorUserId, {
      forceHighRiskItemIds: [conflictItem.id],
      highRiskConfirmation: CONTENT_IMPORT_HIGH_RISK_CONFIRMATION
    })).rejects.toMatchObject({
      code: 'IMPORT_HIGH_RISK_SELECTION_INVALID'
    } satisfies Partial<ContentPrImportError>)
    await expect(importContentPrItems(run.id, [highRiskItem.id], actorUserId, {
      forceHighRiskItemIds: [highRiskItem.id], highRiskConfirmation: '确认'
    })).rejects.toMatchObject({
      code: 'IMPORT_HIGH_RISK_CONFIRMATION_REQUIRED'
    } satisfies Partial<ContentPrImportError>)
    const forced = await importContentPrItems(run.id, [highRiskItem.id], actorUserId, {
      forceHighRiskItemIds: [highRiskItem.id],
      highRiskConfirmation: CONTENT_IMPORT_HIGH_RISK_CONFIRMATION
    })
    expect(forced.results[0]).toMatchObject({ imported: true })
    expect(forced.run).toMatchObject({ importedCount: 6, status: 'imported' })
    expect((await getDatabase().select().from(drafts))).toHaveLength(6)
    expect((await getDatabase().select().from(auditLogs)
      .where(eq(auditLogs.action, 'content_pr_import.high_risk_forced')))).toHaveLength(1)
  })

  it('新增高风险文章确认后只创建带预分配 ID 的待审核草稿', async () => {
    const metadata = buildContentRepositoryMetadata(
      [], [], new Date('2026-01-01T00:00:00.000Z')
    )
    const fake = new FakeGitHub()
    fake.contents.set(`${BASE}:.vinci/snapshot.json`, metadata.snapshotSource)
    fake.contents.set(`${HEAD}:wiki/risky/new.md`, writeCmsMarkdown({
      title: '人工确认的高风险新文章', authors: []
    }, '<iframe src="https://example.com"></iframe>\n'))
    fake.files = [{ filename: 'wiki/risky/new.md', status: 'added', changes: 4 }]

    const run = (await dryRunContentPrImport(actorUserId, {
      repository: 'SDUTVINCI/sdutvinci_content', pullRequestNumber: 8
    }, fake as unknown as ContentImportGitHubClient))!
    expect(run.items[0]).toMatchObject({
      classification: 'high_risk_syntax', importable: false, proposedArticleId: null
    })
    const imported = await importContentPrItems(run.id, [run.items[0]!.id], actorUserId, {
      forceHighRiskItemIds: [run.items[0]!.id],
      highRiskConfirmation: CONTENT_IMPORT_HIGH_RISK_CONFIRMATION
    })
    expect(imported.results[0]).toMatchObject({ imported: true })
    const [draft] = await getDatabase().select().from(drafts)
    expect(draft).toMatchObject({
      articleId: null,
      proposedAction: 'edit',
      proposedRelativePath: 'risky/new.md'
    })
    expect(draft!.proposedArticleId).toMatch(/^[0-9a-f-]{36}$/)
    expect(await getDatabase().select().from(articles)).toEqual([])
    expect(await getDatabase().select().from(articleRevisions)).toEqual([])
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

  it('成员 PR 只生成字段级提案，冲突和敏感字段阻止，明确接受后才创建 Revision', async () => {
    const source = (id: string, name: string, extra = '') =>
      `---\nid: ${id}\nname: ${name}\nrole: Member\ngrade: 2024\n${extra}---\nprofile\n`
    const safe = await seedMember('membersafe', source('membersafe', 'Safe'))
    const merge = await seedMember('membermerge', source('membermerge', 'Merge'), value => value.replace('role: Member', 'role: Captain'))
    const conflict = await seedMember('memberconflict', source('memberconflict', 'Conflict'), value => value.replace('role: Member', 'role: Captain'))
    const sensitive = await seedMember('membersensitive', source('membersensitive', 'Sensitive'))
    const deleted = await seedMember('memberdelete', source('memberdelete', 'Delete'))
    const seeded = [safe, merge, conflict, sensitive, deleted]
    const metadata = buildContentRepositoryMetadata([], [], new Date('2026-01-01T00:00:00.000Z'), seeded.map(item => item.snapshotFile))
    const fake = new FakeGitHub()
    fake.contents.set(`${BASE}:.vinci/snapshot.json`, metadata.snapshotSource)
    for (const item of seeded) fake.contents.set(`${BASE}:${item.path}`, item.baseSource)
    fake.contents.set(`${HEAD}:${safe.path}`, safe.baseSource.replace('name: Safe', 'name: Safe Proposed'))
    fake.contents.set(`${HEAD}:${merge.path}`, merge.baseSource.replace('grade: 2024', 'grade: 2025'))
    fake.contents.set(`${HEAD}:${conflict.path}`, conflict.baseSource.replace('role: Member', 'role: Advisor'))
    fake.contents.set(`${HEAD}:${sensitive.path}`, sensitive.baseSource.replace(/grade:.*\n/, 'metadata:\n  account: stolen\n'))
    fake.files = [
      { filename: safe.path, status: 'modified', changes: 2 },
      { filename: merge.path, status: 'modified', changes: 2 },
      { filename: conflict.path, status: 'modified', changes: 2 },
      { filename: sensitive.path, status: 'modified', changes: 2 },
      { filename: deleted.path, status: 'removed', changes: 2 }
    ]
    const run = (await dryRunContentPrImport(actorUserId, {
      repository: 'SDUTVINCI/sdutvinci_content', pullRequestNumber: 8
    }, fake as unknown as ContentImportGitHubClient))!
    expect(run.items.map(item => item.classification)).toEqual([
      'member_safe_change', 'member_auto_merge', 'member_conflict',
      'member_sensitive_rejected', 'member_deletion_proposal'
    ])
    expect(run.items.every(item => item.targetType === 'member')).toBe(true)
    expect((await getContentPrImportArtifact(run.id, run.items[3]!.id))?.proposedSource).toBeNull()
    const importable = run.items.filter(item => item.importable).map(item => item.id)
    await importContentPrItems(run.id, importable, actorUserId)
    expect(await getDatabase().select().from(memberProposals)).toHaveLength(3)
    expect((await getDatabase().select().from(members).where(eq(members.id, safe.memberId)))[0]!.name).toBe('Safe')
    const safeItem = (await getDatabase().select().from(contentPrImportItems)
      .where(eq(contentPrImportItems.id, run.items[0]!.id)))[0]!
    await applyMemberProposal(safeItem.memberProposalId!, 1, 'APPLY_MEMBER_PROPOSAL', actorUserId)
    expect((await getDatabase().select().from(members).where(eq(members.id, safe.memberId)))[0])
      .toMatchObject({ name: 'Safe Proposed', version: 2 })
    expect(await getDatabase().select().from(memberRevisions).where(eq(memberRevisions.memberId, safe.memberId))).toHaveLength(2)
    await importContentPrItems(run.id, importable, actorUserId)
    expect(await getDatabase().select().from(memberProposals)).toHaveLength(3)
  })

  it('成员 Dry Run 后 Current 再变化会阻止提案且不覆盖正式资料', async () => {
    const seeded = await seedMember('memberstale', '---\nid: memberstale\nname: Stale\nrole: Member\n---\nbase\n')
    const metadata = buildContentRepositoryMetadata([], [], new Date(), [seeded.snapshotFile])
    const fake = new FakeGitHub()
    fake.contents.set(`${BASE}:.vinci/snapshot.json`, metadata.snapshotSource)
    fake.contents.set(`${BASE}:${seeded.path}`, seeded.baseSource)
    fake.contents.set(`${HEAD}:${seeded.path}`, seeded.baseSource.replace('name: Stale', 'name: Proposed'))
    fake.files = [{ filename: seeded.path, status: 'modified', changes: 2 }]
    const run = (await dryRunContentPrImport(actorUserId, {
      repository: 'SDUTVINCI/sdutvinci_content', pullRequestNumber: 8
    }, fake as unknown as ContentImportGitHubClient))!
    const nextSource = seeded.baseSource.replace('name: Stale', 'name: Database Newer')
    const profile = memberProfileFromMarkdown(nextSource, 'memberstale.md')
    const serialized = serializeMemberProfile(profile)
    const nextRevisionId = randomUUID()
    await getDatabase().insert(memberRevisions).values({
      id: nextRevisionId, memberId: seeded.memberId, revisionNumber: 2,
      memberKey: 'memberstale', sourcePath: 'memberstale.md', profile: profileRecord(profile),
      markdownSource: serialized.source, contentHash: serialized.sha256, sourceKind: 'cms_update'
    })
    await getDatabase().update(members).set({
      name: profile.name, currentRevisionId: nextRevisionId, version: 2
    }).where(eq(members.id, seeded.memberId))
    const result = await importContentPrItems(run.id, [run.items[0]!.id], actorUserId)
    expect(result.results[0]).toMatchObject({ blocked: true, proposalId: null })
    expect(await getDatabase().select().from(memberProposals)).toEqual([])
    expect((await getDatabase().select().from(members).where(eq(members.id, seeded.memberId)))[0]!.name)
      .toBe('Database Newer')
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

  it('同一 Wiki 集合可将整个目录跨目录改名，并保持文章 ID、旧链接和移动导出任务', async () => {
    const oldDirectory = '2023-12-10-电控视觉环境搭建'
    const newDirectory = '2023-12-10-机器人开发环境搭建'
    const index = await seedArticle(`${oldDirectory}/index.md`, '目录首页。\n')
    const chapter = await seedArticle(`${oldDirectory}/0100-准备.md`, '章节正文。\n')
    const seeded = [index, chapter]
    const metadata = buildContentRepositoryMetadata(
      seeded.map(item => item.snapshotFile),
      [],
      new Date('2026-01-01T00:00:00.000Z')
    )
    const fake = new FakeGitHub()
    fake.contents.set(`${BASE}:.vinci/snapshot.json`, metadata.snapshotSource)
    for (const item of seeded) fake.contents.set(`${BASE}:${item.path}`, item.baseSource)

    const targetPaths = [
      `wiki/${newDirectory}/index.md`,
      `wiki/${newDirectory}/0100-准备.md`
    ]
    fake.contents.set(`${HEAD}:${targetPaths[0]}`, index.baseSource)
    fake.contents.set(`${HEAD}:${targetPaths[1]}`, chapter.baseSource)
    fake.files = seeded.map((item, ordinal) => ({
      filename: targetPaths[ordinal]!,
      previous_filename: item.path,
      status: 'renamed',
      changes: 0
    }))

    const run = (await dryRunContentPrImport(
      actorUserId,
      { repository: 'SDUTVINCI/sdutvinci_content', pullRequestNumber: 8 },
      fake as unknown as ContentImportGitHubClient
    ))!
    expect(run.items).toHaveLength(2)
    expect(run.items.every(item => item.classification === 'move_or_rename' && item.importable)).toBe(true)
    expect(run.items.map(item => [item.oldPath, item.newPath])).toEqual([
      [index.path, targetPaths[0]],
      [chapter.path, targetPaths[1]]
    ])

    await importContentPrItems(run.id, run.items.map(item => item.id), actorUserId)
    const importedDrafts = await getDatabase().select().from(drafts)
    expect(importedDrafts).toHaveLength(2)
    expect(importedDrafts.every(draft => draft.proposedAction === 'move')).toBe(true)
    expect(importedDrafts.map(draft => draft.proposedRelativePath).sort()).toEqual([
      `${newDirectory}/0100-准备.md`,
      `${newDirectory}/index.md`
    ])

    const [reviewer] = await getDatabase().insert(users).values({
      account: `directorymovereviewer${randomUUID().replaceAll('-', '').slice(0, 8)}`,
      passwordHash: 'unused'
    }).returning({ id: users.id })
    for (const draft of importedDrafts) {
      await getDatabase().update(drafts).set({ status: 'approved' }).where(eq(drafts.id, draft.id))
      await getDatabase().insert(reviewEvents).values({
        draftId: draft.id,
        actorUserId: reviewer!.id,
        action: 'approved',
        fromStatus: 'pending_review',
        toStatus: 'approved'
      })
      await publishCmsDraftDatabase(draft.id, actorUserId, { version: draft.version })
    }

    const movedRows = await getDatabase().select().from(articles)
    const movedById = new Map(movedRows.map(article => [article.id, article]))
    expect(movedById.get(index.articleId)).toMatchObject({
      relativePath: `${newDirectory}/index.md`,
      directory: `wiki/${newDirectory}`
    })
    expect(movedById.get(chapter.articleId)).toMatchObject({
      relativePath: `${newDirectory}/0100-准备.md`,
      directory: `wiki/${newDirectory}`
    })

    const redirects = await getDatabase().select().from(articleRedirects)
    expect(redirects).toHaveLength(2)
    expect((await getPublicArticleFromDatabase(
      'wiki',
      getCmsArticlePublicPath('wiki', `${oldDirectory}/index.md`)
    ))?.id)
      .toBe(index.articleId)
    expect((await getPublicArticleFromDatabase(
      'wiki',
      getCmsArticlePublicPath('wiki', `${oldDirectory}/0100-准备.md`)
    ))?.id)
      .toBe(chapter.articleId)
    expect((await getPublicArticleFromDatabase(
      'wiki',
      getCmsArticlePublicPath('wiki', `${newDirectory}/index.md`)
    ))?.id).toBe(index.articleId)

    const exportJobs = await getDatabase().select().from(contentExportJobs)
    expect(exportJobs).toHaveLength(2)
    expect(exportJobs.every(job => job.operation === 'move')).toBe(true)
    expect(exportJobs.map(job => job.previousPath).sort()).toEqual([
      `wiki/${oldDirectory}/0100-准备.md`,
      `wiki/${oldDirectory}/index.md`
    ])
    expect(exportJobs.map(job => job.targetPath).sort()).toEqual(targetPaths.slice().sort())
  })

  it('跨目录放行不放宽跨内容集合移动', async () => {
    const article = await seedArticle('collection-boundary/source.md', '跨集合保护。\n')
    const metadata = buildContentRepositoryMetadata(
      [article.snapshotFile],
      [],
      new Date('2026-01-01T00:00:00.000Z')
    )
    const fake = new FakeGitHub()
    fake.contents.set(`${BASE}:.vinci/snapshot.json`, metadata.snapshotSource)
    fake.files = [{
      filename: 'news/collection-boundary/source.md',
      previous_filename: article.path,
      status: 'renamed',
      changes: 0
    }]

    const run = (await dryRunContentPrImport(
      actorUserId,
      { repository: 'SDUTVINCI/sdutvinci_content', pullRequestNumber: 8 },
      fake as unknown as ContentImportGitHubClient
    ))!
    expect(run.items[0]).toMatchObject({
      classification: 'invalid_file',
      importable: false,
      warningCodes: ['IMPORT_CROSS_COLLECTION_MOVE']
    })
  })

  it('相同 PR Head 的旧跨目录非法结果会原地重新规划且不重复写审计', async () => {
    const oldPath = 'legacy-old/index.md'
    const newPath = 'legacy-new/index.md'
    const article = await seedArticle(oldPath, '旧 Dry Run 中的正文。\n')
    const metadata = buildContentRepositoryMetadata(
      [article.snapshotFile],
      [],
      new Date('2026-01-01T00:00:00.000Z')
    )
    const fake = new FakeGitHub()
    fake.contents.set(`${BASE}:.vinci/snapshot.json`, metadata.snapshotSource)
    fake.contents.set(`${BASE}:${article.path}`, article.baseSource)
    fake.contents.set(`${HEAD}:wiki/${newPath}`, article.baseSource)
    fake.files = [{
      filename: `wiki/${newPath}`,
      previous_filename: article.path,
      status: 'renamed',
      changes: 0
    }]

    const [legacyRun] = await getDatabase().insert(contentPrImportRuns).values({
      repositoryId: 'SDUTVINCI/sdutvinci_content',
      pullRequestNumber: 8,
      baseCommitHash: BASE,
      headCommitHash: HEAD,
      headRepositoryId: 'SDUTVINCI/sdutvinci_content',
      headRef: 'phase8-content-change',
      baseSnapshotSha256: metadata.snapshotSha256,
      actorUserId,
      prAuthorLabel: 'phase8-proposer',
      status: 'dry_run',
      itemCount: 1,
      importableCount: 0,
      conflictCount: 1,
      completedAt: new Date('2026-01-02T00:00:00.000Z')
    }).returning({ id: contentPrImportRuns.id })
    const [legacyItem] = await getDatabase().insert(contentPrImportItems).values({
      runId: legacyRun!.id,
      ordinal: 0,
      targetType: 'article',
      changeType: 'invalid',
      classification: 'path_conflict',
      importable: false,
      oldPath: article.path,
      newPath: `wiki/${newPath}`,
      proposedArticleId: null,
      warningCodes: ['IMPORT_CROSS_DIRECTORY_MOVE']
    }).returning({ id: contentPrImportItems.id })

    const replanned = (await dryRunContentPrImport(
      actorUserId,
      { repository: 'SDUTVINCI/sdutvinci_content', pullRequestNumber: 8 },
      fake as unknown as ContentImportGitHubClient
    ))!
    expect(replanned.id).toBe(legacyRun!.id)
    expect(replanned).toMatchObject({ importableCount: 1, conflictCount: 0 })
    expect(replanned.items[0]).toMatchObject({
      id: legacyItem!.id,
      changeType: 'renamed',
      classification: 'move_or_rename',
      importable: true,
      status: 'pending',
      articleId: article.articleId,
      warningCodes: []
    })
    expect((await getDatabase().select().from(auditLogs)
      .where(eq(auditLogs.action, 'content_pr_import.legacy_cross_directory_replanned'))))
      .toHaveLength(1)

    const repeated = await dryRunContentPrImport(
      actorUserId,
      { repository: 'SDUTVINCI/sdutvinci_content', pullRequestNumber: 8 },
      fake as unknown as ContentImportGitHubClient
    )
    expect(repeated!.items[0]).toMatchObject({ classification: 'move_or_rename', importable: true })
    expect((await getDatabase().select().from(auditLogs)
      .where(eq(auditLogs.action, 'content_pr_import.legacy_cross_directory_replanned'))))
      .toHaveLength(1)
  })

  it('外部留言、关闭和同仓库源分支清理有顺序约束且重复请求幂等', async () => {
    expect(canUseContentPrImport(['admin'])).toBe(true)
    expect(canUseContentPrImport(['content_importer'])).toBe(false)
    expect(canUseContentPrImport(['member'])).toBe(true)
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
    expect(run.branchCleanup.status).toBe('unavailable')
    process.env.CONTENT_PR_IMPORT_GITHUB_TOKEN = 'github_pat_phase8_test_only_1234567890'
    resetContentImportConfigForTests()
    await executeContentPrExternalAction(run.id, actorUserId, 'comment', fake as unknown as ContentImportGitHubClient)
    fake.comment = async () => { throw new ContentImportGitHubError('DUPLICATE_COMMENT_SHOULD_NOT_RUN', 500) }
    expect(await executeContentPrExternalAction(
      run.id, actorUserId, 'comment', fake as unknown as ContentImportGitHubClient
    )).toMatchObject({ succeeded: true, alreadyCompleted: true })
    await expect(executeContentPrExternalAction(
      run.id, actorUserId, 'delete_branch', fake as unknown as ContentImportGitHubClient,
      { confirmedBranch: 'phase8-content-change' }
    )).rejects.toMatchObject({ code: 'IMPORT_BRANCH_CLEANUP_REQUIRES_CLOSED_PR' })
    await executeContentPrExternalAction(run.id, actorUserId, 'close', fake as unknown as ContentImportGitHubClient)
    expect(await executeContentPrExternalAction(
      run.id, actorUserId, 'close', fake as unknown as ContentImportGitHubClient
    )).toMatchObject({ succeeded: true, alreadyCompleted: true })
    expect(fake.comments).toHaveLength(1)
    expect(fake.comments[0]).not.toContain('基线。')
    expect(fake.comments[0]).toContain('不代表审核、发布或 Merge')
    expect(fake.closed).toBe(1)

    fake.branchSha = '3'.repeat(40)
    await expect(executeContentPrExternalAction(
      run.id, actorUserId, 'delete_branch', fake as unknown as ContentImportGitHubClient,
      { confirmedBranch: 'phase8-content-change' }
    )).rejects.toMatchObject({ code: 'IMPORT_PULL_REQUEST_CHANGED' })
    fake.branchSha = HEAD
    await executeContentPrExternalAction(
      run.id, actorUserId, 'delete_branch', fake as unknown as ContentImportGitHubClient,
      { confirmedBranch: 'phase8-content-change' }
    )
    expect(await executeContentPrExternalAction(
      run.id, actorUserId, 'delete_branch', fake as unknown as ContentImportGitHubClient,
      { confirmedBranch: 'phase8-content-change' }
    )).toMatchObject({ succeeded: true, alreadyCompleted: true })
    expect(fake.deletedBranches).toEqual(['phase8-content-change'])

    const actions = await getDatabase().select().from(contentPrExternalActions)
    expect(actions).toHaveLength(5)
    expect(actions.filter(action => action.status === 'failed').map(action => action.errorCode))
      .toEqual(expect.arrayContaining([
        'IMPORT_BRANCH_CLEANUP_REQUIRES_CLOSED_PR',
        'IMPORT_PULL_REQUEST_CHANGED'
      ]))
    const refreshed = await getContentPrImportRun(run.id)
    expect(refreshed?.headRef).toBe('phase8-content-change')
    expect(refreshed?.branchCleanup.status).toBe('available')
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
      if (url.includes('/git/ref/heads/') && (!init?.method || init.method === 'GET')) {
        return Response.json({ ref: 'refs/heads/phase8-content-change', object: { sha: HEAD, type: 'commit' } })
      }
      if (url.includes('/git/refs/heads/') && init?.method === 'DELETE') {
        return new Response(null, { status: 204 })
      }
      return new Response('{}', { status: 404 })
    }
    const client = new ContentImportGitHubClient({
      CONTENT_PR_IMPORT_MODE: 'enabled',
      CONTENT_PR_IMPORT_REPOSITORY_ID: 'SDUTVINCI/sdutvinci_content',
      CONTENT_PR_IMPORT_API_URL: 'http://mock.test',
      CONTENT_PR_IMPORT_GITHUB_TOKEN: 'test-token',
      CONTENT_PR_IMPORT_MAX_FILE_BYTES: 1024,
      CONTENT_PR_IMPORT_MAX_FILES: 200,
      CONTENT_PR_IMPORT_RETRY_ATTEMPTS: 3,
      CONTENT_PR_IMPORT_TEST_MODE: 'true',
      testMode: true
    }, mockFetch)
    expect(await client.listPullFiles('SDUTVINCI/sdutvinci_content', 8)).toHaveLength(101)
    await client.comment('SDUTVINCI/sdutvinci_content', 8, 'safe summary')
    await client.close('SDUTVINCI/sdutvinci_content', 8)
    expect(await client.getBranchReference(
      'SDUTVINCI/sdutvinci_content', 'phase8-content-change'
    )).toMatchObject({ object: { sha: HEAD, type: 'commit' } })
    await client.deleteBranch('SDUTVINCI/sdutvinci_content', 'phase8-content-change')
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
      CONTENT_PR_IMPORT_MAX_FILE_BYTES: 1024,
      CONTENT_PR_IMPORT_MAX_FILES: 200,
      CONTENT_PR_IMPORT_RETRY_ATTEMPTS: 1,
      CONTENT_PR_IMPORT_TEST_MODE: 'true',
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
    const [page, closeApi, deleteBranchApi, artifactApi] = await Promise.all([
      readFile(resolve('app/pages/cms/content-imports/index.vue'), 'utf8'),
      readFile(resolve('server/api/cms/content-imports/[id]/close.post.ts'), 'utf8'),
      readFile(resolve('server/api/cms/content-imports/[id]/delete-branch.post.ts'), 'utf8'),
      readFile(resolve('server/services/content-pr-import.ts'), 'utf8')
    ])
    expect(page).toContain('导入所选项目')
    expect(page).toContain('不会批准、发布、Merge')
    expect(page).toContain('Base（开始修改时的原文）')
    expect(page).toContain('Current（数据库现在的正式内容）')
    expect(page).toContain('Proposed（这个 PR 想改成的内容）')
    expect(page).toContain('Merge（导入后将进入草稿的内容）')
    expect(page).toContain('把检查结果留言到 PR')
    expect(page).toContain('关闭这个 PR（仅管理员）')
    expect(page).toContain('删除源分支（输入分支名确认）')
    expect(page).toContain('cms-import-input-shell')
    expect(page).toContain('READ-ONLY CHECK')
    expect(page).toContain('cms-import-stats')
    expect(page).toContain("action.status === 'succeeded' ? '✓'")
    expect(page).toContain(':data-kind="line.kind"')
    expect(page).toContain('绿色整行和“+”表示新增')
    expect(page).toContain("artifact?.id === item.id")
    expect(page).toContain('收起三方审计材料')
    expect(closeApi).toContain("roles.includes('admin')")
    expect(deleteBranchApi).toContain("roles.includes('admin')")
    expect(deleteBranchApi).toContain('DELETE_PULL_REQUEST_BRANCH')
    expect(artifactApi).toContain('redactCmsSensitiveText')
    expect(artifactApi).not.toContain('mergePullRequest')
  })
})
