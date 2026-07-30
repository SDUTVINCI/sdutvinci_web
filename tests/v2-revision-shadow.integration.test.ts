import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  unlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDatabase, getDatabase } from '../server/db/client'
import { runMigrations } from '../server/db/migrate'
import {
  articleRevisions,
  articles,
  auditLogs,
  draftAuthors,
  drafts,
  members,
  publishRecords,
  reviewEvents,
  userMembers,
  users
} from '../server/db/schema'
import {
  getCmsArticle,
  listCmsArticles
} from '../server/services/cms-articles'
import { getCmsDashboardStats } from '../server/services/cms-dashboard'
import {
  diffCmsArticleVersions,
  restoreCmsArticleRevision,
  restoreCmsArticleVersion
} from '../server/services/cms-publishing-history'
import { compareCmsGitAndRevisions } from '../server/services/cms-revision-consistency'
import {
  CmsPublishGitError,
  publishCmsDraft
} from '../server/services/cms-publishing'
import { cmsGitArticlePath } from '../server/services/cms-git-worktree'
import {
  appendCmsArticleRevision,
  diffCmsArticleRevisions,
  getCmsArticleRevision,
  listCmsArticleRevisions
} from '../server/services/cms-revisions'
import { parseCmsMarkdown, writeCmsMarkdown } from '../server/utils/cms-frontmatter'
import { resetCmsGitConfigForTests } from '../server/utils/cms-git-config'
import {
  CmsV2ConfigurationError,
  getContentPublishMode,
  getCmsRuntimeNodeEnvironment,
  resetCmsV2FlagsForTests
} from '../server/utils/cms-v2-flags'
import { throwCmsWorkflowError } from '../server/utils/cms-workflow-http'
import { configureCmsTestDatabase } from './helpers/cms-test-database'

const exec = promisify(execFile)
const enabled = configureCmsTestDatabase()
const suite = enabled ? describe : describe.skip
const hash = (source: string) =>
  createHash('sha256').update(source).digest('hex')

suite('V2 阶段 2 Revision 影子写入、历史与恢复', () => {
  let temporaryRoot = ''
  let seedRepository = ''
  let remoteRepository = ''
  let worktree = ''
  let articleId = ''
  let initialRevisionId = ''
  let draftId = ''
  let operatorUserId = ''
  let reviewerUserId = ''
  let initialCommit = ''
  let currentSource = ''

  const git = async (args: string[], cwd = seedRepository) =>
    (await exec('git', args, { cwd })).stdout.trim()

  const approveDraft = async (version: number, body: string) => {
    await getDatabase().update(drafts).set({
      status: 'approved',
      version,
      body,
      baseContentHash: hash(currentSource)
    }).where(eq(drafts.id, draftId))
    await getDatabase().insert(reviewEvents).values({
      draftId,
      actorUserId: reviewerUserId,
      action: 'approved',
      fromStatus: 'pending_review',
      toStatus: 'approved'
    })
  }

  const readRemoteSource = async () =>
    (await exec('git', [
      '--git-dir',
      remoteRepository,
      'show',
      'main:content/news/phase-two.md'
    ])).stdout

  beforeAll(async () => {
    process.env.CONTENT_PUBLISH_MODE = 'revision_shadow'
    resetCmsV2FlagsForTests()
    expect(getContentPublishMode()).toBe('revision_shadow')
    await runMigrations()
    temporaryRoot = await mkdtemp(join(tmpdir(), 'vinci-v2-phase2-test-'))
    seedRepository = join(temporaryRoot, 'seed')
    remoteRepository = join(temporaryRoot, 'remote.git')
    worktree = join(temporaryRoot, 'worktree')
    await mkdir(join(seedRepository, 'content', 'news'), { recursive: true })
    const initialSource = writeCmsMarkdown({
      title: '阶段二文章',
      authors: ['author-key'],
      publishedAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z'
    }, '初始正文\n')
    currentSource = initialSource
    await writeFile(
      join(seedRepository, 'content', 'news', 'phase-two.md'),
      initialSource
    )
    await git(['init', '-b', 'main'])
    await git(['config', 'user.name', 'Test Seed'])
    await git(['config', 'user.email', 'seed@example.test'])
    await git(['add', '.'])
    await git(['commit', '-m', 'seed content'])
    initialCommit = await git(['rev-parse', 'HEAD'])
    await exec('git', ['init', '--bare', remoteRepository])
    await git(['remote', 'add', 'origin', remoteRepository])
    await git(['push', '-u', 'origin', 'main'])
    await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], remoteRepository)

    process.env.CMS_GIT_WORKTREE = worktree
    process.env.CMS_GIT_REMOTE_URL = remoteRepository
    process.env.CMS_GIT_REMOTE = 'origin'
    process.env.CMS_GIT_BRANCH = 'main'
    process.env.CMS_GIT_AUTHOR_NAME = 'Vinci CMS Test'
    process.env.CMS_GIT_AUTHOR_EMAIL = 'cms@localhost'
    process.env.CMS_CONTENT_ROOT = join(seedRepository, 'content')
    delete process.env.CMS_GIT_SSH_KEY_PATH
    resetCmsGitConfigForTests()

    const db = getDatabase()
    await db.execute(`
      truncate table rate_limit_buckets, content_export_jobs, content_export_runs, article_deletion_events, publish_records, edit_locks,
      review_events, audit_logs, sessions, draft_authors, article_revisions, drafts,
      user_members, user_roles, articles, members, users restart identity cascade
    `)
    const createdUsers = await db.insert(users).values([
      { account: 'owner', passwordHash: 'unused' },
      { account: 'reviewer', passwordHash: 'unused' },
      { account: 'operator', passwordHash: 'unused' }
    ]).returning()
    const ownerUserId = createdUsers[0]!.id
    reviewerUserId = createdUsers[1]!.id
    operatorUserId = createdUsers[2]!.id
    const createdMembers = await db.insert(members).values([
      { memberKey: 'owner-key', name: 'Owner' },
      { memberKey: 'author-key', name: 'Author' }
    ]).returning()
    await db.insert(userMembers).values({
      userId: ownerUserId,
      memberId: createdMembers[0]!.id
    })
    const parsed = parseCmsMarkdown(initialSource)
    const [article] = await db.insert(articles).values({
      collection: 'news',
      relativePath: 'phase-two.md',
      publicPath: '/news/phase-two',
      directory: 'news',
      title: '阶段二文章',
      frontmatter: parsed.frontmatter,
      searchText: '阶段二文章',
      contentHash: hash(initialSource)
    }).returning()
    articleId = article!.id
    const [initialRevision] = await db.insert(articleRevisions).values({
      articleId,
      revisionNumber: 1,
      markdownSource: initialSource,
      body: parsed.body,
      frontmatter: parsed.frontmatter,
      contentHash: hash(initialSource),
      sourceKind: 'backfill'
    }).returning()
    initialRevisionId = initialRevision!.id
    await db.update(articles).set({
      currentRevisionId: initialRevisionId
    }).where(eq(articles.id, articleId))
    const [draft] = await db.insert(drafts).values({
      articleId,
      ownerUserId,
      collection: 'news',
      title: '阶段二文章',
      body: '首次影子发布正文\n',
      preservedFrontmatter: parsed.frontmatter,
      baseContentHash: hash(initialSource),
      baseRevisionId: initialRevisionId,
      status: 'approved',
      version: 1
    }).returning()
    draftId = draft!.id
    await db.insert(draftAuthors).values({
      draftId,
      memberId: createdMembers[1]!.id,
      position: 0
    })
    await db.insert(reviewEvents).values({
      draftId,
      actorUserId: reviewerUserId,
      action: 'approved',
      fromStatus: 'pending_review',
      toStatus: 'approved'
    })
  })

  afterAll(async () => {
    delete process.env.CONTENT_PUBLISH_MODE
    delete process.env.CMS_CONTENT_ROOT
    resetCmsV2FlagsForTests()
    resetCmsGitConfigForTests()
    await closeDatabase()
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true })
  })

  it('Git Push 成功后只追加一个 Revision，并原子更新草稿基线和审计', async () => {
    const result = await publishCmsDraft(draftId, operatorUserId, { version: 1 })
    currentSource = await readRemoteSource()
    const revisions = await listCmsArticleRevisions(articleId)
    expect(revisions).toHaveLength(2)
    expect(revisions[0]).toMatchObject({
      revisionNumber: 2,
      sourceKind: 'publish',
      sourceDraftId: draftId,
      publishedByUserId: operatorUserId,
      reviewedByUserId: reviewerUserId,
      gitCommitHash: result.commitHash
    })
    const [draft] = await getDatabase().select().from(drafts).where(eq(drafts.id, draftId))
    const [article] = await getDatabase().select().from(articles).where(eq(articles.id, articleId))
    expect(draft?.baseRevisionId).toBe(revisions[0]!.id)
    expect(article?.currentRevisionId).toBe(revisions[0]!.id)
    const [record] = await getDatabase()
      .select()
      .from(publishRecords)
      .where(eq(publishRecords.commitHash, result.commitHash))
    expect(revisions[0]!.sourceOperationId).toBe(record?.id)
    expect((await getDatabase().select().from(auditLogs))
      .some(log => log.action === 'article.publish'
        && log.metadata.revisionId === revisions[0]!.id)).toBe(true)
    await getCmsDashboardStats(operatorUserId, true)
    const listed = await listCmsArticles()
    expect(listed.articles.find(item => item.id === articleId)).toMatchObject({
      isPresent: true,
      contentHash: hash(currentSource)
    })
    expect((await getCmsArticle(articleId))?.body).toBe('首次影子发布正文\n')
    const detail = await getCmsArticleRevision(articleId, revisions[0]!.id)
    const retried = await getDatabase().transaction(tx =>
      appendCmsArticleRevision(tx, {
        articleId,
        markdownSource: detail.markdownSource,
        body: detail.body,
        frontmatter: detail.frontmatter,
        contentHash: detail.contentHash,
        sourceKind: 'publish',
        sourceDraftId: draftId,
        publishedByUserId: operatorUserId,
        reviewedByUserId: reviewerUserId,
        sourceOperationId: detail.sourceOperationId!,
        gitCommitHash: detail.gitCommitHash!,
        createdAt: new Date()
      }))
    expect(retried.id).toBe(detail.id)
    expect((await listCmsArticleRevisions(articleId))).toHaveLength(2)
  })

  it('并发与成功后的重试不会生成重复 Revision', async () => {
    await approveDraft(3, '并发发布正文\n')
    const results = await Promise.allSettled([
      publishCmsDraft(draftId, operatorUserId, { version: 3 }),
      publishCmsDraft(draftId, operatorUserId, { version: 3 })
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    currentSource = await readRemoteSource()
    expect((await listCmsArticleRevisions(articleId))).toHaveLength(3)
    await expect(
      publishCmsDraft(draftId, operatorUserId, { version: 3 })
    ).rejects.toBeTruthy()
    expect((await listCmsArticleRevisions(articleId))).toHaveLength(3)
  })

  it('Git Push 失败不生成 Revision，修复后重试只追加一次', async () => {
    await approveDraft(5, '推送失败后成功正文\n')
    const hook = join(remoteRepository, 'hooks', 'pre-receive')
    await writeFile(hook, '#!/bin/sh\nexit 1\n')
    await chmod(hook, 0o755)
    await expect(
      publishCmsDraft(draftId, operatorUserId, { version: 5 })
    ).rejects.toBeInstanceOf(CmsPublishGitError)
    expect((await listCmsArticleRevisions(articleId))).toHaveLength(3)
    await unlink(hook)
    await publishCmsDraft(draftId, operatorUserId, { version: 5 })
    currentSource = await readRemoteSource()
    expect((await listCmsArticleRevisions(articleId))).toHaveLength(4)
  })

  it('数据库历史、详情、排序和正文 Diff 与 Git 结果一致', async () => {
    const revisions = await listCmsArticleRevisions(articleId)
    expect(revisions.map(revision => revision.revisionNumber)).toEqual([4, 3, 2, 1])
    const latest = await getCmsArticleRevision(articleId, revisions[0]!.id)
    expect(latest.body).toBe('推送失败后成功正文\n')
    const dbDiff = await diffCmsArticleRevisions(
      articleId,
      initialRevisionId,
      latest.id
    )
    const gitDiff = await diffCmsArticleVersions(
      articleId,
      initialCommit,
      latest.gitCommitHash!,
      'body'
    )
    expect(dbDiff.parts).toEqual(gitDiff.parts)
  })

  it('Git 与数据库恢复都追加新 Revision，不覆盖旧历史', async () => {
    const beforeGitRestore = await listCmsArticleRevisions(articleId)
    await restoreCmsArticleVersion(articleId, initialCommit, operatorUserId)
    const afterGitRestore = await listCmsArticleRevisions(articleId)
    expect(afterGitRestore).toHaveLength(beforeGitRestore.length + 1)
    expect(afterGitRestore[0]).toMatchObject({
      sourceKind: 'restore',
      restoredFromRevisionId: initialRevisionId
    })
    const sourceRevision = beforeGitRestore.find(
      revision => revision.sourceKind === 'publish'
    )!
    await restoreCmsArticleRevision(articleId, sourceRevision.id, operatorUserId)
    const afterDbRestore = await listCmsArticleRevisions(articleId)
    expect(afterDbRestore).toHaveLength(afterGitRestore.length + 1)
    expect(afterDbRestore[0]).toMatchObject({
      sourceKind: 'restore',
      restoredFromRevisionId: sourceRevision.id
    })
    expect(afterDbRestore.map(revision => revision.id))
      .toEqual(expect.arrayContaining(
        beforeGitRestore.map(revision => revision.id)
      ))
  })

  it('只读一致性报告核对时间、作者、审核、正文和哈希且无自动修复', async () => {
    const report = await compareCmsGitAndRevisions(articleId)
    expect(report.mode).toBe('read_only')
    expect(report.mismatchCount).toBe(0)
    expect(report.unmatchedGitCommitCount).toBe(0)
    expect(report.articles[0]!.checks.every(check => check.matches)).toBe(true)
    expect(report.articles[0]!.checks.some(
      check => check.checks.reviewer === true
    )).toBe(true)
    const cli = await exec(
      'npm',
      ['run', 'v2:revisions:compare', '--', `--article-id=${articleId}`],
      { cwd: process.cwd(), env: process.env }
    )
    const cliReport = JSON.parse(
      cli.stdout.slice(cli.stdout.indexOf('{'))
    )
    expect(cliReport).toMatchObject({
      mode: 'read_only',
      mismatchCount: 0,
      unmatchedGitCommitCount: 0
    })
  })

  it('影子模式在非测试环境 fail closed，恢复入口保留管理员与 CSRF 检查', async () => {
    expect(() => cmsGitArticlePath('news', '../../.env'))
      .toThrow('CONTENT_PATH_OUTSIDE_ROOT')
    const originalNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    resetCmsV2FlagsForTests()
    expect(() => getContentPublishMode()).toThrow(/只允许/)
    expect(() => getContentPublishMode()).toThrow(/只允许/)
    process.env.NODE_ENV = originalNodeEnv
    resetCmsV2FlagsForTests()
    expect(getCmsRuntimeNodeEnvironment()).toBe('test')
    expect(getContentPublishMode()).toBe('revision_shadow')
    const flagSource = await readFile(
      join(process.cwd(), 'server/utils/cms-v2-flags.ts'),
      'utf8'
    )
    expect(flagSource).toContain("Reflect.get(process.env, 'NODE_ENV')")
    expect(flagSource).not.toMatch(/process\.env(?:\.NODE_ENV|\[['"]NODE_ENV['"]\])/)
    try {
      throwCmsWorkflowError(new CmsV2ConfigurationError('测试边界错误'))
      expect.unreachable('配置错误必须转换为 HTTP 错误')
    } catch (error: any) {
      expect(error).toMatchObject({
        statusCode: 503,
        message: 'V2 内容权威配置无效：测试边界错误'
      })
    }
    const routeSource = await readFile(
      join(
        process.cwd(),
        'server/api/cms/articles/[id]/revisions/[revision]/restore.post.ts'
      ),
      'utf8'
    )
    expect(routeSource).toContain("requireCmsRequestAuth(event, 'admin')")
    expect(routeSource).toContain('requireCmsCsrf(event, auth)')
    expect(routeSource).toContain('requireCmsRevisionShadowApi()')
    for (const route of [
      'index.get.ts',
      '[revision].get.ts',
      'diff.get.ts'
    ]) {
      const readRouteSource = await readFile(
        join(
          process.cwd(),
          'server/api/cms/articles/[id]/revisions',
          route
        ),
        'utf8'
      )
      expect(readRouteSource).toContain('requireCmsRequestAuth(event)')
      expect(readRouteSource).toContain('requireCmsRevisionShadowApi()')
    }
  })
})
