import { createHash, randomUUID } from 'node:crypto'
import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { Client } from 'pg'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, getDatabase } from '../server/db/client'
import { runMigrations } from '../server/db/migrate'
import {
  articleDeletionEvents,
  articleRevisions,
  articles,
  auditLogs,
  contentExportJobs,
  draftAuthors,
  drafts,
  members,
  publishRecords,
  reviewEvents,
  userMembers,
  users
} from '../server/db/schema'
import { getCmsArticle } from '../server/services/cms-articles'
import {
  deleteCmsArticleDatabase,
  restoreCmsDeletedArticleDatabase
} from '../server/services/cms-deletions-database'
import { checkCmsPhase5Consistency } from '../server/services/cms-phase5-consistency'
import {
  diffCmsArticleVersions,
  getCmsArticleVersion,
  listCmsArticleHistory,
  restoreCmsArticleVersion
} from '../server/services/cms-publishing-history'
import {
  publishCmsDraftDatabase
} from '../server/services/cms-publishing-database'
import {
  CmsPublishConflictError,
  CmsPublishStateError,
  publishCmsDraft
} from '../server/services/cms-publishing'
import {
  getCachedPublicRevision,
  invalidatePublicContentCache,
  setCachedPublicRevision
} from '../server/services/public-content-cache'
import {
  getPublicArticleFromDatabase
} from '../server/services/public-content'
import { parseCmsMarkdown, writeCmsMarkdown } from '../server/utils/cms-frontmatter'
import {
  getContentPublishMode,
  resetCmsV2FlagsForTests
} from '../server/utils/cms-v2-flags'
import {
  getPublicContentSourceConfig
} from '../server/utils/public-content-flags'
import { configureCmsTestDatabase } from './helpers/cms-test-database'

const enabled = configureCmsTestDatabase()
const suite = enabled ? describe : describe.skip
const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex')

interface Seed {
  articleId: string
  draftId: string
  ownerUserId: string
  reviewerUserId: string
  operatorUserId: string
  initialRevisionId: string
  initialSource: string
}

suite('V2 阶段 5 数据库权威与 DB-first 发布事务', () => {
  let noGitRoot = ''
  const originalEnvironment = {
    NODE_ENV: process.env.NODE_ENV,
    CONTENT_PUBLISH_MODE: process.env.CONTENT_PUBLISH_MODE,
    CONTENT_CANDIDATE_ENV: process.env.CONTENT_CANDIDATE_ENV,
    CONTENT_SOURCE_NEWS: process.env.CONTENT_SOURCE_NEWS,
    CONTENT_SOURCE_WIKI: process.env.CONTENT_SOURCE_WIKI,
    CONTENT_SOURCE_MEMBERS: process.env.CONTENT_SOURCE_MEMBERS,
    CMS_GIT_WORKTREE: process.env.CMS_GIT_WORKTREE,
    CMS_GIT_REMOTE_URL: process.env.CMS_GIT_REMOTE_URL,
    CMS_CONTENT_ROOT: process.env.CMS_CONTENT_ROOT
  }

  const seed = async (): Promise<Seed> => {
    const db = getDatabase()
    const account = (prefix: string) =>
      `${prefix}${randomUUID().replaceAll('-', '').slice(0, 20)}`
    const createdUsers = await db.insert(users).values([
      { account: account('owner'), passwordHash: 'unused' },
      { account: account('reviewer'), passwordHash: 'unused' },
      { account: account('operator'), passwordHash: 'unused' }
    ]).returning()
    const ownerUserId = createdUsers[0]!.id
    const reviewerUserId = createdUsers[1]!.id
    const operatorUserId = createdUsers[2]!.id
    const createdMembers = await db.insert(members).values([
      { memberKey: `owner-${randomUUID()}`, name: 'Owner' },
      { memberKey: `author-${randomUUID()}`, name: 'Author' }
    ]).returning()
    await db.insert(userMembers).values({
      userId: ownerUserId,
      memberId: createdMembers[0]!.id
    })
    const initialSource = writeCmsMarkdown({
      title: '阶段五数据库文章',
      description: '初始描述',
      authors: [createdMembers[1]!.memberKey],
      publishedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      preservedField: 'kept'
    }, '数据库初始正文\n')
    const parsed = parseCmsMarkdown(initialSource)
    const [article] = await db.insert(articles).values({
      collection: 'news',
      relativePath: 'phase5-test.md',
      publicPath: '/news/phase5-test',
      directory: 'news',
      title: '阶段五数据库文章',
      frontmatter: parsed.frontmatter,
      searchText: '阶段五数据库文章',
      contentHash: sha256(initialSource)
    }).returning()
    const [revision] = await db.insert(articleRevisions).values({
      articleId: article!.id,
      revisionNumber: 1,
      markdownSource: initialSource,
      body: parsed.body,
      frontmatter: parsed.frontmatter,
      contentHash: sha256(initialSource),
      sourceKind: 'backfill'
    }).returning()
    await db.update(articles).set({
      currentRevisionId: revision!.id
    }).where(eq(articles.id, article!.id))
    const [draft] = await db.insert(drafts).values({
      articleId: article!.id,
      ownerUserId,
      collection: 'news',
      title: '阶段五数据库文章',
      description: 'DB-first 描述',
      body: 'DB-first 新正文\n',
      preservedFrontmatter: parsed.frontmatter,
      baseContentHash: sha256(initialSource),
      baseRevisionId: revision!.id,
      status: 'approved',
      version: 1
    }).returning()
    await db.insert(draftAuthors).values({
      draftId: draft!.id,
      memberId: createdMembers[1]!.id,
      position: 0
    })
    await db.insert(reviewEvents).values({
      draftId: draft!.id,
      actorUserId: reviewerUserId,
      action: 'approved',
      fromStatus: 'pending_review',
      toStatus: 'approved'
    })
    return {
      articleId: article!.id,
      draftId: draft!.id,
      ownerUserId,
      reviewerUserId,
      operatorUserId,
      initialRevisionId: revision!.id,
      initialSource
    }
  }

  beforeAll(async () => {
    process.env.CONTENT_PUBLISH_MODE = 'database'
    process.env.CONTENT_CANDIDATE_ENV = 'test'
    process.env.CONTENT_SOURCE_NEWS = 'database'
    process.env.CONTENT_SOURCE_WIKI = 'database'
    process.env.CONTENT_SOURCE_MEMBERS = 'legacy_git'
    process.env.CMS_GIT_WORKTREE = '/phase5-test/git-must-not-be-used'
    process.env.CMS_GIT_REMOTE_URL = 'ssh://invalid.phase5.test/no-access'
    noGitRoot = await mkdtemp(join(tmpdir(), 'vinci-v2-phase5-no-git-'))
    process.env.CMS_CONTENT_ROOT = join(noGitRoot, 'content-must-not-be-written')
    resetCmsV2FlagsForTests()
    await runMigrations()
  })

  beforeEach(async () => {
    resetCmsV2FlagsForTests()
    invalidatePublicContentCache()
    await getDatabase().execute(`
      truncate table rate_limit_buckets, media_assets, content_export_jobs, content_export_runs,
      article_deletion_events, publish_records, edit_locks, review_events,
      audit_logs, sessions, draft_authors, article_revisions, drafts,
      user_members, user_roles, articles, members, users
      restart identity cascade
    `)
  })

  afterAll(async () => {
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    resetCmsV2FlagsForTests()
    await closeDatabase()
    if (noGitRoot) await rm(noGitRoot, { recursive: true, force: true })
  })

  it('默认权威开关为 news/wiki 数据库，members 保持旧链路', () => {
    expect(getContentPublishMode()).toBe('database')
    expect(getPublicContentSourceConfig()).toEqual({
      environment: 'test',
      sources: {
        news: 'database',
        wiki: 'database',
        members: 'legacy_git'
      }
    })
  })

  it('CMS 详情直接使用权威 Revision 字段，不重新解析历史 Markdown 源码', async () => {
    const seeded = await seed()
    await getDatabase().update(articleRevisions).set({
      markdownSource: '---\ntitle: [无法重新解析\n---\n不应读取的正文',
      body: 'Revision 已解析正文\n',
      frontmatter: {
        title: 'Revision 权威标题',
        preservedField: 'kept'
      }
    }).where(eq(articleRevisions.id, seeded.initialRevisionId))

    await expect(getCmsArticle(seeded.articleId)).resolves.toMatchObject({
      title: 'Revision 权威标题',
      body: 'Revision 已解析正文\n',
      frontmatter: {
        title: 'Revision 权威标题',
        preservedField: 'kept'
      }
    })
  })

  it('生产运行时即使省略变量也安全采用 DB-first/news/wiki database 默认值', () => {
    const values = {
      NODE_ENV: process.env.NODE_ENV,
      CONTENT_PUBLISH_MODE: process.env.CONTENT_PUBLISH_MODE,
      CONTENT_CANDIDATE_ENV: process.env.CONTENT_CANDIDATE_ENV,
      CONTENT_SOURCE_NEWS: process.env.CONTENT_SOURCE_NEWS,
      CONTENT_SOURCE_WIKI: process.env.CONTENT_SOURCE_WIKI,
      CONTENT_SOURCE_MEMBERS: process.env.CONTENT_SOURCE_MEMBERS
    }
    process.env.NODE_ENV = 'production'
    delete process.env.CONTENT_PUBLISH_MODE
    delete process.env.CONTENT_CANDIDATE_ENV
    delete process.env.CONTENT_SOURCE_NEWS
    delete process.env.CONTENT_SOURCE_WIKI
    delete process.env.CONTENT_SOURCE_MEMBERS
    resetCmsV2FlagsForTests()
    try {
      expect(getContentPublishMode()).toBe('database')
      expect(getPublicContentSourceConfig()).toEqual({
        environment: 'production',
        sources: {
          news: 'database',
          wiki: 'database',
          members: 'database'
        }
      })
    } finally {
      for (const [key, value] of Object.entries(values)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      resetCmsV2FlagsForTests()
    }
  })

  it('四个显式开关可完整回退到 legacy_git，且不会隐式保留数据库前台', () => {
    process.env.CONTENT_PUBLISH_MODE = 'legacy_git'
    process.env.CONTENT_CANDIDATE_ENV = 'disabled'
    process.env.CONTENT_SOURCE_NEWS = 'legacy_git'
    process.env.CONTENT_SOURCE_WIKI = 'legacy_git'
    process.env.CONTENT_SOURCE_MEMBERS = 'legacy_git'
    resetCmsV2FlagsForTests()
    try {
      expect(getContentPublishMode()).toBe('legacy_git')
      expect(getPublicContentSourceConfig()).toEqual({
        environment: 'disabled',
        sources: {
          news: 'legacy_git',
          wiki: 'legacy_git',
          members: 'legacy_git'
        }
      })
    } finally {
      process.env.CONTENT_PUBLISH_MODE = 'database'
      process.env.CONTENT_CANDIDATE_ENV = 'test'
      process.env.CONTENT_SOURCE_NEWS = 'database'
      process.env.CONTENT_SOURCE_WIKI = 'database'
      process.env.CONTENT_SOURCE_MEMBERS = 'legacy_git'
      resetCmsV2FlagsForTests()
    }
  })

  it('production 对只切发布或只切前台的混合权威配置 fail closed', () => {
    const values = {
      NODE_ENV: process.env.NODE_ENV,
      CONTENT_PUBLISH_MODE: process.env.CONTENT_PUBLISH_MODE,
      CONTENT_CANDIDATE_ENV: process.env.CONTENT_CANDIDATE_ENV,
      CONTENT_SOURCE_NEWS: process.env.CONTENT_SOURCE_NEWS,
      CONTENT_SOURCE_WIKI: process.env.CONTENT_SOURCE_WIKI
    }
    process.env.NODE_ENV = 'production'
    process.env.CONTENT_CANDIDATE_ENV = 'production'
    process.env.CONTENT_PUBLISH_MODE = 'legacy_git'
    process.env.CONTENT_SOURCE_NEWS = 'database'
    process.env.CONTENT_SOURCE_WIKI = 'legacy_git'
    resetCmsV2FlagsForTests()
    try {
      expect(() => getPublicContentSourceConfig()).toThrow(
        '与 production 发布权威 legacy_git 不一致'
      )
    } finally {
      for (const [key, value] of Object.entries(values)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      resetCmsV2FlagsForTests()
    }
  })

  it('一个事务写入 Revision、当前投影、草稿基线、审核发布记录、审计和唯一 Outbox，Git 不可用仍成功', async () => {
    const seeded = await seed()
    const unrelatedKey = `phase4:news:${randomUUID()}:revision:${randomUUID()}`
    const oldKey =
      `phase4:news:${seeded.articleId}:revision:${seeded.initialRevisionId}`
    setCachedPublicRevision(oldKey, { stale: true }, {
      collection: 'news',
      articleId: seeded.articleId,
      revisionId: seeded.initialRevisionId
    })
    setCachedPublicRevision(unrelatedKey, { retained: true }, {
      collection: 'news',
      articleId: randomUUID(),
      revisionId: randomUUID()
    })

    const result = await publishCmsDraft(
      seeded.draftId,
      seeded.operatorUserId,
      { version: 1 }
    )
    expect(result).toMatchObject({
      articleId: seeded.articleId,
      commitHash: null,
      revisionNumber: 2,
      exportStatus: 'waiting_export'
    })
    expect(result.revisionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )

    const db = getDatabase()
    const [article] = await db.select().from(articles)
      .where(eq(articles.id, seeded.articleId))
    const [revision] = await db.select().from(articleRevisions)
      .where(eq(articleRevisions.id, result.revisionId!))
    const [draft] = await db.select().from(drafts)
      .where(eq(drafts.id, seeded.draftId))
    const [record] = await db.select().from(publishRecords)
      .where(eq(publishRecords.id, revision!.sourceOperationId!))
    const jobs = await db.select().from(contentExportJobs)
      .where(eq(contentExportJobs.revisionId, revision!.id))
    const logs = await db.select().from(auditLogs)
      .where(eq(auditLogs.targetId, seeded.articleId))
    expect(article?.currentRevisionId).toBe(revision?.id)
    expect(article?.contentHash).toBe(revision?.contentHash)
    expect(revision).toMatchObject({
      revisionNumber: 2,
      sourceKind: 'publish',
      sourceDraftId: seeded.draftId,
      publishedByUserId: seeded.operatorUserId,
      reviewedByUserId: seeded.reviewerUserId,
      gitCommitHash: null
    })
    expect(draft).toMatchObject({
      status: 'published',
      baseRevisionId: revision?.id,
      version: 2
    })
    expect(record).toMatchObject({
      status: 'succeeded',
      commitHash: null,
      reviewerUserId: seeded.reviewerUserId
    })
    expect(record?.metadata).toMatchObject({
      authority: 'database',
      revisionId: revision?.id,
      exportJobId: jobs[0]?.id
    })
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({
      targetType: 'article',
      targetId: seeded.articleId,
      operation: 'update',
      status: 'pending',
      attemptCount: 0
    })
    expect(logs.some(log =>
      log.action === 'article.publish'
      && log.metadata.revisionId === revision?.id
      && log.metadata.exportJobId === jobs[0]?.id
    )).toBe(true)

    const publicArticle = await getPublicArticleFromDatabase(
      'news',
      '/news/phase5-test'
    )
    expect(publicArticle).toMatchObject({
      body: 'DB-first 新正文\n',
      revisionId: revision?.id,
      revisionNumber: 2
    })
    expect(getCachedPublicRevision(oldKey)).toBeNull()
    expect(getCachedPublicRevision(unrelatedKey)).toEqual({ retained: true })
    await expect(access(process.env.CMS_CONTENT_ROOT!)).rejects.toMatchObject({
      code: 'ENOENT'
    })
    expect(await readdir(noGitRoot)).toEqual([])
    expect((await getCmsArticle(seeded.articleId))?.exportStatus.state)
      .toBe('waiting_export')
    expect((await checkCmsPhase5Consistency()).issueCount).toBe(0)
  })

  it.each(['after_revision', 'after_outbox'] as const)(
    '事务在 %s 注入失败时完整回滚，不留下部分 Revision 或 Outbox',
    async (failAt) => {
      const seeded = await seed()
      await expect(publishCmsDraftDatabase(
        seeded.draftId,
        seeded.operatorUserId,
        { version: 1 },
        { failAt }
      )).rejects.toThrow(`PHASE5_TEST_FAIL_${
        failAt === 'after_revision' ? 'AFTER_REVISION' : 'AFTER_OUTBOX'
      }`)
      const [article] = await getDatabase().select().from(articles)
        .where(eq(articles.id, seeded.articleId))
      const [draft] = await getDatabase().select().from(drafts)
        .where(eq(drafts.id, seeded.draftId))
      expect(article?.currentRevisionId).toBe(seeded.initialRevisionId)
      expect(draft).toMatchObject({
        status: 'approved',
        baseRevisionId: seeded.initialRevisionId,
        version: 1
      })
      expect(await getDatabase().select().from(articleRevisions)).toHaveLength(1)
      expect(await getDatabase().select().from(contentExportJobs)).toHaveLength(0)
      expect(await getDatabase().select().from(publishRecords)).toHaveLength(0)
      expect(await getDatabase().select().from(auditLogs)).toHaveLength(0)
    }
  )

  it('新文章首次发布创建 Revision #1 和 create Outbox，不覆盖既有路径', async () => {
    const seeded = await seed()
    const [author] = await getDatabase().select().from(members)
    const [draft] = await getDatabase().insert(drafts).values({
      ownerUserId: seeded.ownerUserId,
      collection: 'wiki',
      title: '阶段五新 Wiki',
      body: '新 Wiki DB-first 正文\n',
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
      actorUserId: seeded.reviewerUserId,
      action: 'approved',
      fromStatus: 'pending_review',
      toStatus: 'approved'
    })
    const result = await publishCmsDraft(
      draft!.id,
      seeded.operatorUserId,
      { version: 1, relativePath: 'phase5-new-wiki.md' }
    )
    expect(result).toMatchObject({
      collection: 'wiki',
      relativePath: 'phase5-new-wiki.md',
      commitHash: null,
      revisionNumber: 1,
      exportStatus: 'waiting_export'
    })
    const [article] = await getDatabase().select().from(articles)
      .where(eq(articles.id, result.articleId))
    const [job] = await getDatabase().select().from(contentExportJobs)
      .where(eq(contentExportJobs.revisionId, result.revisionId!))
    expect(article?.currentRevisionId).toBe(result.revisionId)
    expect(job).toMatchObject({
      targetId: result.articleId,
      operation: 'create',
      status: 'pending'
    })
    expect((await checkCmsPhase5Consistency()).issueCount).toBe(0)
  })

  it('两个不同草稿并发发布同一文章时由文章行锁串行化，只产生一个 Revision #2', async () => {
    const seeded = await seed()
    const [secondOwner] = await getDatabase().insert(users).values({
      account: `second${randomUUID().replaceAll('-', '').slice(0, 20)}`,
      passwordHash: 'unused'
    }).returning()
    const [author] = await getDatabase().select().from(members)
    const parsed = parseCmsMarkdown(seeded.initialSource)
    const [secondDraft] = await getDatabase().insert(drafts).values({
      articleId: seeded.articleId,
      ownerUserId: secondOwner!.id,
      collection: 'news',
      title: '阶段五数据库文章',
      body: '第二个并发草稿\n',
      preservedFrontmatter: parsed.frontmatter,
      baseContentHash: sha256(seeded.initialSource),
      baseRevisionId: seeded.initialRevisionId,
      status: 'approved',
      version: 1
    }).returning()
    await getDatabase().insert(draftAuthors).values({
      draftId: secondDraft!.id,
      memberId: author!.id,
      position: 0
    })
    await getDatabase().insert(reviewEvents).values({
      draftId: secondDraft!.id,
      actorUserId: seeded.reviewerUserId,
      action: 'approved',
      fromStatus: 'pending_review',
      toStatus: 'approved'
    })

    const attempts = await Promise.allSettled([
      publishCmsDraft(seeded.draftId, seeded.operatorUserId, { version: 1 }),
      publishCmsDraft(secondDraft!.id, seeded.operatorUserId, { version: 1 })
    ])
    expect(attempts.filter(item => item.status === 'fulfilled')).toHaveLength(1)
    expect(attempts.filter(item =>
      item.status === 'rejected'
      && item.reason instanceof CmsPublishConflictError
    )).toHaveLength(1)
    const revisions = await getDatabase().select().from(articleRevisions)
      .where(eq(articleRevisions.articleId, seeded.articleId))
    expect(revisions.map(row => row.revisionNumber).sort()).toEqual([1, 2])
    expect(await getDatabase().select().from(contentExportJobs)).toHaveLength(1)
    expect(await getDatabase().select().from(publishRecords)).toHaveLength(1)
    expect((await checkCmsPhase5Consistency()).issueCount).toBe(0)
  })

  it('拒绝过期 base_revision_id，两个并发发布只提交一个且 Revision 序号连续', async () => {
    const stale = await seed()
    const parsed = parseCmsMarkdown(writeCmsMarkdown(
      { title: '并发前置版本' },
      '并发前置正文\n'
    ))
    const source = writeCmsMarkdown({ title: '并发前置版本' }, '并发前置正文\n')
    const [intervening] = await getDatabase().insert(articleRevisions).values({
      articleId: stale.articleId,
      revisionNumber: 2,
      markdownSource: source,
      body: parsed.body,
      frontmatter: parsed.frontmatter,
      contentHash: sha256(source),
      sourceKind: 'backfill'
    }).returning()
    await getDatabase().update(articles).set({
      currentRevisionId: intervening!.id,
      frontmatter: parsed.frontmatter,
      contentHash: sha256(source)
    }).where(eq(articles.id, stale.articleId))
    await expect(publishCmsDraft(
      stale.draftId,
      stale.operatorUserId,
      { version: 1 }
    )).rejects.toBeInstanceOf(CmsPublishConflictError)
    expect(await getDatabase().select().from(contentExportJobs)).toHaveLength(0)

    await getDatabase().update(drafts).set({
      baseRevisionId: intervening!.id,
      baseContentHash: sha256(source)
    }).where(eq(drafts.id, stale.draftId))
    const attempts = await Promise.allSettled([
      publishCmsDraft(stale.draftId, stale.operatorUserId, { version: 1 }),
      publishCmsDraft(stale.draftId, stale.operatorUserId, { version: 1 })
    ])
    expect(attempts.filter(item => item.status === 'fulfilled')).toHaveLength(1)
    expect(attempts.filter(item =>
      item.status === 'rejected'
      && item.reason instanceof CmsPublishStateError
    )).toHaveLength(1)
    const revisions = await getDatabase().select().from(articleRevisions)
      .where(eq(articleRevisions.articleId, stale.articleId))
    expect(revisions.map(row => row.revisionNumber).sort()).toEqual([1, 2, 3])
    expect(await getDatabase().select().from(contentExportJobs)).toHaveLength(1)
    expect(await getDatabase().select().from(publishRecords)).toHaveLength(1)
  })

  it('历史、详情、Diff 与恢复都以 Revision 为准，恢复追加新 Revision 和 Outbox', async () => {
    const seeded = await seed()
    const published = await publishCmsDraft(
      seeded.draftId,
      seeded.operatorUserId,
      { version: 1 }
    )
    const history = await listCmsArticleHistory(seeded.articleId)
    expect(history.map(item => item.revisionNumber)).toEqual([2, 1])
    expect(history.every(item => item.authority === 'database')).toBe(true)
    const version = await getCmsArticleVersion(
      seeded.articleId,
      seeded.initialRevisionId
    )
    expect(version).toMatchObject({
      authority: 'database',
      revisionNumber: 1,
      source: seeded.initialSource
    })
    const diff = await diffCmsArticleVersions(
      seeded.articleId,
      seeded.initialRevisionId,
      published.revisionId!
    )
    expect(diff.authority).toBe('database')
    expect(diff.parts.some(part =>
      part.type === 'removed' && part.value.includes('数据库初始正文')
    )).toBe(true)
    expect(diff.parts.some(part =>
      part.type === 'added' && part.value.includes('DB-first 新正文')
    )).toBe(true)

    const restored = await restoreCmsArticleVersion(
      seeded.articleId,
      seeded.initialRevisionId,
      seeded.operatorUserId
    )
    expect(restored).toMatchObject({
      commitHash: null,
      revisionNumber: 3,
      exportStatus: 'waiting_export'
    })
    const current = await getPublicArticleFromDatabase(
      'news',
      '/news/phase5-test'
    )
    expect(current).toMatchObject({
      body: '数据库初始正文\n',
      revisionId: restored.revisionId,
      revisionNumber: 3
    })
    const [restoreRevision] = await getDatabase().select()
      .from(articleRevisions)
      .where(eq(articleRevisions.id, restored.revisionId!))
    expect(restoreRevision).toMatchObject({
      sourceKind: 'restore',
      restoredFromRevisionId: seeded.initialRevisionId,
      gitCommitHash: null
    })
    expect(await getDatabase().select().from(contentExportJobs))
      .toHaveLength(2)
    expect((await checkCmsPhase5Consistency()).issueCount).toBe(0)
  })

  it('删除与恢复使用数据库当前 Revision；失败回滚，成功立即上下线并写审计与 Outbox', async () => {
    const seeded = await seed()
    await expect(deleteCmsArticleDatabase(
      seeded.articleId,
      seeded.operatorUserId,
      { failAt: 'after_outbox' }
    )).rejects.toThrow('PHASE5_TEST_FAIL_AFTER_DELETE_OUTBOX')
    expect((await getDatabase().select().from(articles)
      .where(eq(articles.id, seeded.articleId)))[0]?.deletedAt).toBeNull()
    expect(await getDatabase().select().from(contentExportJobs)).toHaveLength(0)
    expect(await getDatabase().select().from(articleDeletionEvents)).toHaveLength(0)

    const deleted = await deleteCmsArticleDatabase(
      seeded.articleId,
      seeded.operatorUserId
    )
    expect(deleted).toMatchObject({
      commitHash: null,
      revisionId: seeded.initialRevisionId,
      revisionNumber: 1,
      exportStatus: 'waiting_export'
    })
    expect(await getPublicArticleFromDatabase(
      'news',
      '/news/phase5-test'
    )).toBeNull()

    const restored = await restoreCmsDeletedArticleDatabase(
      seeded.articleId,
      seeded.operatorUserId
    )
    expect(restored).toMatchObject({
      commitHash: null,
      revisionNumber: 2,
      exportStatus: 'waiting_export'
    })
    expect((await getPublicArticleFromDatabase(
      'news',
      '/news/phase5-test'
    ))?.body).toBe('数据库初始正文\n')
    const events = await getDatabase().select().from(articleDeletionEvents)
    expect(events.map(event => event.operation).sort())
      .toEqual(['delete', 'restore'])
    expect(events.every(event =>
      event.sourceRevisionId
      && event.resultRevisionId
      && event.exportJobId
      && event.sourceCommitHash === null
      && event.commitHash === null
    )).toBe(true)
    expect(await getDatabase().select().from(contentExportJobs)).toHaveLength(2)
    expect((await getDatabase().select().from(auditLogs))
      .map(log => log.action).sort()).toEqual([
      'article.delete',
      'article.restore'
    ])
    expect((await checkCmsPhase5Consistency()).issueCount).toBe(0)
  })

  it('迁移可先于旧应用发布：0012 旧写法在 0013 前后都可执行', async () => {
    const testUrl = new URL(process.env.TEST_DATABASE_URL!)
    const baseName = basename(testUrl.pathname)
    const compatibilityName = `${baseName}_expand_contract`
    expect(compatibilityName).toMatch(/test/)
    const adminUrl = new URL(testUrl)
    adminUrl.pathname = '/postgres'
    const compatibilityUrl = new URL(testUrl)
    compatibilityUrl.pathname = `/${compatibilityName}`
    const quotedName = `"${compatibilityName.replaceAll('"', '""')}"`
    const admin = new Client({ connectionString: adminUrl.toString() })
    await admin.connect()
    try {
      await admin.query(`drop database if exists ${quotedName} with (force)`)
      await admin.query(`create database ${quotedName}`)
      const candidate = new Client({ connectionString: compatibilityUrl.toString() })
      await candidate.connect()
      try {
        const migrationFolder = resolve('server/db/migrations')
        const migrationFiles = (await readdir(migrationFolder))
          .filter(name => /^\d{4}_.+\.sql$/.test(name))
          .sort()
        const apply = async (name: string) => {
          const source = await readFile(join(migrationFolder, name), 'utf8')
          await candidate.query('begin')
          try {
            await candidate.query(source.replaceAll('--> statement-breakpoint', ''))
            await candidate.query('commit')
          } catch (error) {
            await candidate.query('rollback')
            throw error
          }
        }
        for (const name of migrationFiles.filter(name => name < '0013_')) {
          await apply(name)
        }
        const oldWrite = async (suffix: string) => {
          const user = await candidate.query<{ id: string }>(
            `insert into users (account, password_hash)
             values ($1, 'unused') returning id`,
            [`oldslot${suffix}`]
          )
          const article = await candidate.query<{ id: string }>(
            `insert into articles (
               collection, relative_path, public_path, directory, title,
               frontmatter, search_text, content_hash
             ) values (
               'news', $1, $2, 'news', 'old slot', '{}', 'old slot',
               repeat('a', 64)
             ) returning id`,
            [`old-slot-${suffix}.md`, `/news/old-slot-${suffix}`]
          )
          await candidate.query(
            `insert into article_deletion_events (
               article_id, actor_user_id, operation, article_path,
               source_commit_hash, commit_hash
             ) values ($1, $2, 'delete', $3, repeat('b', 40), repeat('c', 40))`,
            [
              article.rows[0]!.id,
              user.rows[0]!.id,
              `news/old-slot-${suffix}.md`
            ]
          )
        }
        await oldWrite('before')
        await apply(migrationFiles.find(name => name.startsWith('0013_'))!)
        await oldWrite('after')
        const result = await candidate.query(
          'select count(*)::int as count from article_deletion_events'
        )
        expect(result.rows[0]?.count).toBe(2)
        expect((await candidate.query(
          `select to_regclass('public.content_export_jobs') as name`
        )).rows[0]?.name).toBe('content_export_jobs')
      } finally {
        await candidate.end()
      }
    } finally {
      await admin.query(`drop database if exists ${quotedName} with (force)`)
      await admin.end()
    }
  }, 60_000)

  it('管理端写接口保留登录、角色、CSRF，DB-first 服务不导入 Git 或文件写入实现', async () => {
    const writeRoutes = [
      'server/api/cms/drafts/[id]/publish.post.ts',
      'server/api/cms/articles/[id]/versions/[commit]/restore.post.ts',
      'server/api/cms/articles/[id]/delete.post.ts',
      'server/api/cms/articles/[id]/restore-deleted.post.ts'
    ]
    for (const path of writeRoutes) {
      const source = await readFile(resolve(path), 'utf8')
      expect(source).toContain("requireCmsRequestAuth(event, 'admin')")
      expect(source).toContain('requireCmsCsrf(event, auth)')
    }
    for (const path of [
      'server/services/cms-publishing-database.ts',
      'server/services/cms-deletions-database.ts',
      'server/services/cms-phase5-consistency.ts'
    ]) {
      const source = await readFile(resolve(path), 'utf8')
      expect(source).not.toMatch(/cms-git|node:fs|execFile|runCmsGit/)
    }
    const migration = await readFile(
      resolve('server/db/migrations/0013_charming_iceman.sql'),
      'utf8'
    )
    expect(migration).not.toMatch(/\bDROP TABLE\b|\bDROP COLUMN\b/i)
    expect(migration).toContain('content_export_jobs')
  })
})
