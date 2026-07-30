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
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDatabase, getDatabase } from '../server/db/client'
import { runMigrations } from '../server/db/migrate'
import {
  articleDeletionEvents,
  articles,
  draftAuthors,
  drafts,
  members,
  publishRecords,
  reviewEvents,
  userMembers,
  users
} from '../server/db/schema'
import {
  diffCmsArticleVersions,
  getCmsArticleVersion,
  listCmsArticleHistory,
  restoreCmsArticleVersion
} from '../server/services/cms-publishing-history'
import {
  CmsPublishGitError,
  publishCmsDraft
} from '../server/services/cms-publishing'
import {
  CmsArticleDeletionGitError,
  deleteCmsArticle,
  restoreCmsArticle
} from '../server/services/cms-deletions'
import { createCmsDraftForArticle } from '../server/services/cms-drafts'
import { parseCmsMarkdown, writeCmsMarkdown } from '../server/utils/cms-frontmatter'
import { resetCmsGitConfigForTests } from '../server/utils/cms-git-config'
import { resetCmsV2FlagsForTests } from '../server/utils/cms-v2-flags'
import { configureCmsTestDatabase } from './helpers/cms-test-database'

const exec = promisify(execFile)
const enabled = configureCmsTestDatabase()
const suite = enabled ? describe : describe.skip
const hash = (value: string) => createHash('sha256').update(value).digest('hex')

suite('CMS 阶段 5 Git 发布与历史集成', () => {
  let temporaryRoot = ''
  let seedRepository = ''
  let remoteRepository = ''
  let worktree = ''
  let deploymentRoot = ''
  let articleId = ''
  let draftId = ''
  let ownerUserId = ''
  let reviewerUserId = ''
  let operatorUserId = ''
  let initialCommit = ''
  let firstPublishCommit = ''
  let currentSource = ''

  const git = async (args: string[], cwd = seedRepository) =>
    (await exec('git', args, { cwd })).stdout.trim()

  beforeAll(async () => {
    process.env.CONTENT_PUBLISH_MODE = 'legacy_git'
    resetCmsV2FlagsForTests()
    await runMigrations()
    temporaryRoot = await mkdtemp(join(tmpdir(), 'vinci-cms-publish-test-'))
    seedRepository = join(temporaryRoot, 'seed')
    remoteRepository = join(temporaryRoot, 'remote.git')
    worktree = join(temporaryRoot, 'worktree')
    deploymentRoot = join(temporaryRoot, 'deployment-content')
    await mkdir(join(seedRepository, 'content', 'news'), { recursive: true })
    await mkdir(join(seedRepository, 'content', 'wiki'), { recursive: true })
    await mkdir(join(deploymentRoot, 'news'), { recursive: true })
    const initialSource = writeCmsMarkdown({
      title: '阶段五文章',
      description: '旧描述',
      authors: ['author-key'],
      publishedAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      customField: 'preserved'
    }, '旧正文\n')
    currentSource = initialSource
    await writeFile(
      join(seedRepository, 'content', 'news', 'phase-five.md'),
      initialSource
    )
    await writeFile(
      join(deploymentRoot, 'news', 'phase-five.md'),
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
    // Git 允许本机身份使用 cms@localhost；配置校验不得误按公网邮箱拒绝。
    process.env.CMS_GIT_AUTHOR_EMAIL = 'cms@localhost'
    delete process.env.CMS_GIT_SSH_KEY_PATH
    process.env.CMS_CONTENT_ROOT = deploymentRoot
    resetCmsGitConfigForTests()

    const db = getDatabase()
    await db.execute(`
      truncate table rate_limit_buckets, content_export_jobs, content_export_runs, article_deletion_events, publish_records, edit_locks, review_events, audit_logs, sessions,
      draft_authors, article_revisions, drafts, user_members, user_roles, articles, members, users
      restart identity cascade
    `)
    const createdUsers = await db.insert(users).values([
      { account: 'owner', passwordHash: 'unused' },
      { account: 'reviewer', passwordHash: 'unused' },
      { account: 'operator', passwordHash: 'unused' }
    ]).returning()
    ownerUserId = createdUsers[0]!.id
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
    const [article] = await db.insert(articles).values({
      collection: 'news',
      relativePath: 'phase-five.md',
      publicPath: '/news/phase-five',
      directory: 'news',
      title: '阶段五文章',
      frontmatter: parseCmsMarkdown(initialSource).frontmatter,
      searchText: '阶段五文章',
      contentHash: hash(initialSource)
    }).returning()
    articleId = article!.id
    const [draft] = await db.insert(drafts).values({
      articleId,
      ownerUserId,
      collection: 'news',
      title: '阶段五文章',
      description: '',
      body: '第一次发布正文\n',
      preservedFrontmatter: {
        publishedAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
        customField: 'preserved'
      },
      baseContentHash: hash(initialSource),
      status: 'approved',
      version: 3
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
    resetCmsV2FlagsForTests()
    await closeDatabase()
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true })
  })

  it('仅在推送成功后发布，并保留首次发布时间和未知 Frontmatter', async () => {
    const result = await publishCmsDraft(draftId, operatorUserId, { version: 3 })
    firstPublishCommit = result.commitHash
    currentSource = (await exec(
      'git',
      ['--git-dir', remoteRepository, 'show', `main:content/news/phase-five.md`]
    )).stdout
    const parsed = parseCmsMarkdown(currentSource)
    expect(parsed.body).toBe('第一次发布正文\n')
    expect(parsed.frontmatter).toMatchObject({
      publishedAt: '2025-01-01T00:00:00.000Z',
      customField: 'preserved',
      contributors: ['owner-key'],
      authors: ['author-key']
    })
    expect(parsed.frontmatter.updatedAt).not.toBe('2025-01-01T00:00:00.000Z')
    const [draft] = await getDatabase().select().from(drafts).where(eq(drafts.id, draftId))
    const [record] = await getDatabase()
      .select()
      .from(publishRecords)
      .where(eq(publishRecords.commitHash, result.commitHash))
    expect(draft?.status).toBe('published')
    expect(record).toMatchObject({
      status: 'succeeded',
      operatorUserId,
      reviewerUserId
    })
    expect(await readFile(join(deploymentRoot, 'news', 'phase-five.md'), 'utf8'))
      .not.toContain('第一次发布正文')
  })

  it('推送失败时不标记成功，保留已通过草稿并可重试', async () => {
    const hook = join(remoteRepository, 'hooks', 'pre-receive')
    await writeFile(hook, '#!/bin/sh\nexit 1\n')
    await chmod(hook, 0o755)
    await getDatabase().update(drafts).set({
      status: 'approved',
      version: 5,
      body: '推送失败后重试正文\n',
      baseContentHash: hash(currentSource)
    }).where(eq(drafts.id, draftId))
    await getDatabase().insert(reviewEvents).values({
      draftId,
      actorUserId: reviewerUserId,
      action: 'approved',
      fromStatus: 'pending_review',
      toStatus: 'approved'
    })

    await expect(
      publishCmsDraft(draftId, operatorUserId, { version: 5 })
    ).rejects.toBeInstanceOf(CmsPublishGitError)
    const [failedDraft] = await getDatabase()
      .select()
      .from(drafts)
      .where(eq(drafts.id, draftId))
    const records = await getDatabase()
      .select()
      .from(publishRecords)
      .where(eq(publishRecords.draftId, draftId))
    expect(failedDraft?.status).toBe('approved')
    expect(records.some(record => record.status === 'failed' && record.failureReason)).toBe(true)
    const rejectedRemoteSource = (await exec(
      'git',
      ['--git-dir', remoteRepository, 'show', 'main:content/news/phase-five.md']
    )).stdout
    expect(rejectedRemoteSource).toBe(currentSource)

    await unlink(hook)
    const retried = await publishCmsDraft(draftId, operatorUserId, { version: 5 })
    expect(retried.commitHash).not.toBe(firstPublishCommit)
    currentSource = (await exec(
      'git',
      ['--git-dir', remoteRepository, 'show', 'main:content/news/phase-five.md']
    )).stdout
    expect(parseCmsMarkdown(currentSource).body).toBe('推送失败后重试正文\n')
  })

  it('可查看、比较并以新提交恢复历史版本', async () => {
    const historyBefore = await listCmsArticleHistory(articleId)
    expect(historyBefore.length).toBeGreaterThanOrEqual(3)
    const initial = await getCmsArticleVersion(articleId, initialCommit)
    expect(parseCmsMarkdown(initial.source).body).toBe('旧正文\n')
    const comparison = await diffCmsArticleVersions(
      articleId,
      initialCommit,
      historyBefore[0]!.commitHash
    )
    expect(comparison.parts.some(part => part.type === 'removed' && part.value.includes('旧正文')))
      .toBe(true)
    const restored = await restoreCmsArticleVersion(
      articleId,
      initialCommit,
      operatorUserId
    )
    expect(restored.commitHash).not.toBe(initialCommit)
    const historyAfter = await listCmsArticleHistory(articleId)
    expect(historyAfter.length).toBe(historyBefore.length + 1)
    expect(historyAfter.some(entry => entry.commitHash === initialCommit)).toBe(true)
    const remoteSource = (await exec(
      'git',
      ['--git-dir', remoteRepository, 'show', 'main:content/news/phase-five.md']
    )).stdout
    expect(parseCmsMarkdown(remoteSource).body).toBe('旧正文\n')
  })

  it('软删除正式文章会下线文件，并可通过新提交恢复', async () => {
    const hook = join(remoteRepository, 'hooks', 'pre-receive')
    await writeFile(hook, '#!/bin/sh\nexit 1\n')
    await chmod(hook, 0o755)
    await expect(deleteCmsArticle(articleId, operatorUserId))
      .rejects.toBeInstanceOf(CmsArticleDeletionGitError)
    const [notDeleted] = await getDatabase().select().from(articles).where(eq(articles.id, articleId))
    expect(notDeleted?.deletedAt).toBeNull()
    await unlink(hook)

    const deleted = await deleteCmsArticle(articleId, operatorUserId)
    expect(deleted.commitHash).toMatch(/^[0-9a-f]{7,40}$/)
    await expect(
      exec('git', ['--git-dir', remoteRepository, 'show', 'main:content/news/phase-five.md'])
    ).rejects.toBeTruthy()
    const [deletedRow] = await getDatabase().select().from(articles).where(eq(articles.id, articleId))
    expect(deletedRow?.deletedAt).toBeTruthy()
    expect((await getDatabase().select().from(articleDeletionEvents).where(eq(articleDeletionEvents.articleId, articleId)))
      .some(event => event.operation === 'delete')).toBe(true)

    const restored = await restoreCmsArticle(articleId, operatorUserId)
    expect(restored.commitHash).not.toBe(deleted.commitHash)
    const restoredSource = (await exec(
      'git',
      ['--git-dir', remoteRepository, 'show', 'main:content/news/phase-five.md']
    )).stdout
    expect(parseCmsMarkdown(restoredSource).body).toBe('旧正文\n')
    const [restoredRow] = await getDatabase().select().from(articles).where(eq(articles.id, articleId))
    expect(restoredRow?.deletedAt).toBeNull()
    expect((await getDatabase().select().from(articleDeletionEvents).where(eq(articleDeletionEvents.articleId, articleId)))
      .some(event => event.operation === 'restore')).toBe(true)
  })

  it('为新文章生成安全且不冲突的默认路径并登记正式文章', async () => {
    const [author] = await getDatabase()
      .select()
      .from(members)
      .where(eq(members.memberKey, 'author-key'))
    const [draft] = await getDatabase().insert(drafts).values({
      ownerUserId,
      collection: 'wiki',
      title: '新的 Wiki 条目',
      body: '新条目正文\n',
      status: 'approved',
      version: 1
    }).returning()
    await getDatabase().insert(draftAuthors).values({
      draftId: draft!.id,
      memberId: author!.id,
      position: 0
    })
    await getDatabase().insert(reviewEvents).values({
      draftId: draft!.id,
      actorUserId: reviewerUserId,
      action: 'approved',
      fromStatus: 'pending_review',
      toStatus: 'approved'
    })
    const result = await publishCmsDraft(draft!.id, operatorUserId, { version: 1 })
    expect(result.relativePath).toMatch(/\.md$/)
    const [published] = await getDatabase()
      .select()
      .from(drafts)
      .where(eq(drafts.id, draft!.id))
    expect(published?.articleId).toBe(result.articleId)
    const source = (await exec(
      'git',
      ['--git-dir', remoteRepository, 'show', `main:content/wiki/${result.relativePath}`]
    )).stdout
    expect(parseCmsMarkdown(source).body).toBe('新条目正文\n')
  })

  it('已发布草稿可从文章入口重新进入下一轮编辑', async () => {
    const reopened = await createCmsDraftForArticle(articleId, ownerUserId)
    expect(reopened.id).toBe(draftId)
    expect(reopened.status).toBe('draft')
    expect(reopened.version).toBeGreaterThan(5)
  })
})
