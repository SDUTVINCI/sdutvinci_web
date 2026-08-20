import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDatabase, getDatabase } from '../server/db/client'
import { runMigrations } from '../server/db/migrate'
import {
  articleRevisions,
  articles,
  memberRevisions,
  members
} from '../server/db/schema'
import { getCmsArticlePublicPath } from '../server/services/cms-articles'
import {
  buildPublicDatabaseRss,
  buildPublicDatabaseSitemap
} from '../server/services/public-content-feeds'
import {
  getPublicArticleFromDatabase,
  getPublicMemberFromDatabase,
  listPublicArticlesFromDatabase,
  listPublicMembersFromDatabase,
  listRestrictedWikiDocumentsFromDatabase,
  resolvePublicArticleAccessFromDatabase,
  searchPublicArticlesFromDatabase
} from '../server/services/public-content'
import {
  createPublicRevisionCacheKey,
  getPublicContentCacheStats,
  invalidatePublicContentCache
} from '../server/services/public-content-cache'
import { compareWikiChapters, numberWikiChapters } from '../utils/wiki-chapters'
import { configureCmsTestDatabase } from './helpers/cms-test-database'
import { memberProfileFromMarkdown, profileRecord, serializeMemberProfile } from '../server/services/member-profile'

const enabled = configureCmsTestDatabase()
const databaseSuite = enabled ? describe : describe.skip
const hash = (source: string) =>
  createHash('sha256').update(source).digest('hex')
const sourceEnvironmentKeys = [
  'NODE_ENV',
  'NUXT_PUBLIC_SITE_URL'
] as const
const originalEnvironment = Object.fromEntries(
  sourceEnvironmentKeys.map(key => [key, process.env[key]])
)

const restoreEnvironment = () => {
  for (const key of sourceEnvironmentKeys) {
    const value = originalEnvironment[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

describe('V2 阶段 10 PostgreSQL 唯一公开内容入口', () => {
  afterAll(restoreEnvironment)

  it('保留稳定公共路径算法且不再暴露运行时来源开关', async () => {
    for (const key of sourceEnvironmentKeys) delete process.env[key]
    expect(getCmsArticlePublicPath(
      'news',
      '2024-07-06-接受赛委会采访.md'
    )).toBe('/news/2024-07-06')
    await expect(readFile('server/api/v2/content/config.get.ts', 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('公开 API、Sitemap 与 RSS 固定调用 PostgreSQL 服务', async () => {
    const paths = [
      'server/api/v2/content/news/index.get.ts',
      'server/api/v2/content/wiki/index.get.ts',
      'server/api/v2/content/members/index.get.ts',
      'server/api/v2/content/search.get.ts',
      'server/routes/sitemap.xml.get.ts',
      'server/routes/rss.xml.get.ts'
    ]
    const sources = await Promise.all(paths.map(path => readFile(path, 'utf8')))
    expect(sources.every(source => source.includes('public-content'))).toBe(true)
    expect(sources.join('\n')).not.toContain('getPublicContentSource')
    expect(sources.join('\n')).not.toContain('queryCollection')
  })
})

databaseSuite('V2 阶段 4 正式内容查询、缓存与候选 Feed', () => {
  const articleIds: Record<string, string> = {}
  const revisionIds: Record<string, string> = {}

  const seedArticle = async (input: {
    key: string
    collection: 'news' | 'wiki'
    relativePath: string
    publicPath: string
    title: string
    body: string
    frontmatter?: Record<string, unknown>
    isPresent?: 'true' | 'false'
  }) => {
    const markdownSource = `---\ntitle: ${input.title}\n---\n${input.body}`
    const [article] = await getDatabase().insert(articles).values({
      collection: input.collection,
      relativePath: input.relativePath,
      publicPath: input.publicPath,
      directory: input.relativePath.split('/').slice(0, -1).join('/'),
      title: input.title,
      frontmatter: input.frontmatter || {},
      searchText: `${input.title} ${input.body}`,
      contentHash: hash(markdownSource),
      isPresent: input.isPresent || 'true'
    }).returning()
    const [revision] = await getDatabase().insert(articleRevisions).values({
      articleId: article!.id,
      revisionNumber: 1,
      markdownSource,
      body: input.body,
      frontmatter: {
        title: input.title,
        ...(input.frontmatter || {})
      },
      contentHash: hash(markdownSource),
      sourceKind: 'backfill'
    }).returning()
    await getDatabase().update(articles).set({
      currentRevisionId: revision!.id
    }).where(eq(articles.id, article!.id))
    articleIds[input.key] = article!.id
    revisionIds[input.key] = revision!.id
  }

  beforeAll(async () => {
    await runMigrations()
    await getDatabase().execute(`
      truncate table rate_limit_buckets, content_export_jobs, content_export_runs, article_deletion_events, publish_records, edit_locks,
      review_events, audit_logs, sessions, draft_authors, article_revisions, drafts,
      user_members, user_roles, articles, members, users restart identity cascade
    `)
    await seedArticle({
      key: 'news',
      collection: 'news',
      relativePath: 'phase4-test-news.md',
      publicPath: '/news/phase4-test-news',
      title: '阶段四数据库新闻',
      body: '# 正文\n\n可搜索的机器人候选内容。',
      frontmatter: {
        date: '2026-07-29',
        summary: '阶段四影子新闻摘要',
        tags: ['phase4', 'test']
      }
    })
    await seedArticle({
      key: 'wiki-index',
      collection: 'wiki',
      relativePath: '2026-07-29-阶段四测试/index.md',
      publicPath: '/wiki/2026-07-29-jie-duan-si-ce-shi',
      title: '阶段四测试',
      body: '# 目录\n'
    })
    await seedArticle({
      key: 'wiki-first',
      collection: 'wiki',
      relativePath: '2026-07-29-阶段四测试/0100-开始.md',
      publicPath: '/wiki/2026-07-29-jie-duan-si-ce-shi/0100-kai-shi',
      title: '开始',
      body: '## 第一节\n'
    })
    await seedArticle({
      key: 'wiki-second',
      collection: 'wiki',
      relativePath: '2026-07-29-阶段四测试/0200-继续.md',
      publicPath: '/wiki/2026-07-29-jie-duan-si-ce-shi/0200-ji-xu',
      title: '继续',
      body: '## 第二节\n'
    })
    await seedArticle({
      key: 'deleted',
      collection: 'news',
      relativePath: 'phase4-test-deleted.md',
      publicPath: '/news/phase4-test-deleted',
      title: '已删除候选',
      body: '不应公开',
      isPresent: 'false'
    })
    const memberSource = '---\nid: phase4member\nname: 阶段四成员\nimage: /images/logo.png\nrole: 控制组\ntime: 2026\nlinks:\n  github: https://example.test/phase4\n---\n数据库成员正文\n'
    const memberProfile = memberProfileFromMarkdown(memberSource, '2018/王虓.md')
    const memberSerialized = serializeMemberProfile(memberProfile)
    const [member] = await getDatabase().insert(members).values({
      memberKey: 'phase4member',
      name: '阶段四成员',
      avatarUrl: '/images/logo.png',
      sourcePath: '2018/王虓.md',
      role: memberProfile.role, seasons: memberProfile.seasons,
      links: memberProfile.links, body: memberProfile.body, metadata: {}
    }).returning()
    const [memberRevision] = await getDatabase().insert(memberRevisions).values({
      memberId: member!.id, revisionNumber: 1, memberKey: member!.memberKey,
      sourcePath: member!.sourcePath, profile: profileRecord(memberProfile),
      markdownSource: memberSerialized.source, contentHash: memberSerialized.sha256,
      sourceKind: 'backfill'
    }).returning()
    await getDatabase().update(members).set({ currentRevisionId: memberRevision!.id })
      .where(eq(members.id, member!.id))
    process.env.NUXT_PUBLIC_SITE_URL = 'https://phase4.test'
  })

  afterAll(async () => {
    invalidatePublicContentCache()
    restoreEnvironment()
    await closeDatabase()
  })

  it('新闻列表和详情只读取 current_revision，返回 Revision ID 缓存键', async () => {
    const list = await listPublicArticlesFromDatabase('news')
    expect(list.map(item => item.path)).toEqual(['/news/phase4-test-news'])
    const detail = await getPublicArticleFromDatabase(
      'news',
      '/news/phase4-test-news/'
    )
    expect(detail).toMatchObject({
      id: articleIds.news,
      revisionId: revisionIds.news,
      revisionNumber: 1,
      body: '# 正文\n\n可搜索的机器人候选内容。',
      summary: '阶段四影子新闻摘要'
    })
    expect(detail?.cacheKey).toBe(createPublicRevisionCacheKey(
      'news',
      articleIds.news!,
      revisionIds.news!
    ))
    expect(await getPublicArticleFromDatabase(
      'news',
      '/news/phase4-test-deleted'
    )).toBeNull()
    expect(await getPublicArticleFromDatabase(
      'news',
      '/news/phase4-test-missing'
    )).toBeNull()
  })

  it('Wiki 数据库候选生成文档元数据、章节顺序和前后页顺序', async () => {
    const pages = await listPublicArticlesFromDatabase('wiki')
    expect(pages).toHaveLength(3)
    expect(pages.every(page => page.isWikiDoc === true)).toBe(true)
    const docKey = pages[0]!.docKey
    expect(pages.every(page => page.docKey === docKey)).toBe(true)
    const index = pages.find(page => page.isWikiIndex)
    const chapters = numberWikiChapters(
      pages.filter(page => !page.isWikiIndex)
    ).sort(compareWikiChapters)
    expect(index?.docRoot).toBe('/wiki/2026-07-29-jie-duan-si-ce-shi')
    expect(chapters.map(page => page.chapter)).toEqual(['1', '2'])
    expect([index, ...chapters].map(page => page?.title))
      .toEqual(['阶段四测试', '开始', '继续'])
  })

  it('成员列表和详情都只读取数据库结构化资料与正文', async () => {
    const list = await listPublicMembersFromDatabase()
    expect(list).toMatchObject([{
      memberKey: 'phase4member',
      name: '阶段四成员',
      role: '控制组',
      body: '数据库成员正文\n'
    }])
    const detail = await getPublicMemberFromDatabase('phase4member')
    expect(detail?.body).toBe('数据库成员正文\n')
    expect(await getPublicMemberFromDatabase('阶段四成员')).toMatchObject({
      memberKey: 'phase4member'
    })
    expect(await getPublicMemberFromDatabase('missing')).toBeNull()
  })

  it('数据库搜索仅返回公开 current revision，Sitemap/RSS 使用候选数据', async () => {
    expect(await searchPublicArticlesFromDatabase('机器人')).toMatchObject([{
      path: '/news/phase4-test-news',
      revisionId: revisionIds.news
    }])
    expect(await searchPublicArticlesFromDatabase('不应公开')).toEqual([])
    const [sitemap, rss] = await Promise.all([
      buildPublicDatabaseSitemap(),
      buildPublicDatabaseRss()
    ])
    expect(sitemap).toContain(
      '<loc>https://phase4.test/news/phase4-test-news</loc>'
    )
    expect(sitemap).toContain(
      '<loc>https://phase4.test/team/phase4member</loc>'
    )
    expect(sitemap).not.toContain('phase4-test-deleted')
    expect(rss).toContain('<title>阶段四数据库新闻</title>')
    expect(rss).not.toContain('已删除候选')
  })

  it('默认隐藏需登录文章，登录访问选项可读取且不会进入公开 Feed', async () => {
    await getDatabase().update(articles)
      .set({ requiresAuth: true })
      .where(eq(articles.id, articleIds.news!))
    await getDatabase().update(articles)
      .set({ requiresAuth: true })
      .where(eq(articles.id, articleIds['wiki-first']!))
    invalidatePublicContentCache({ articleId: articleIds.news })
    invalidatePublicContentCache({ articleId: articleIds['wiki-first'] })

    try {
      expect(await listPublicArticlesFromDatabase('news')).toEqual([])
      expect(await getPublicArticleFromDatabase(
        'news',
        '/news/phase4-test-news'
      )).toBeNull()
      expect(await searchPublicArticlesFromDatabase('机器人')).toEqual([])
      expect(await listPublicArticlesFromDatabase('wiki')).toHaveLength(2)
      expect(await listRestrictedWikiDocumentsFromDatabase()).toEqual([{
        docKey: '2026-07-29-jie-duan-si-ce-shi',
        path: '/wiki/2026-07-29-jie-duan-si-ce-shi/0100-kai-shi',
        title: '阶段四测试',
        date: '2026-07-29'
      }])

      await getDatabase().update(articles)
        .set({ requiresAuth: true })
        .where(eq(articles.id, articleIds['wiki-index']!))
      await getDatabase().update(articles)
        .set({ requiresAuth: true })
        .where(eq(articles.id, articleIds['wiki-second']!))
      invalidatePublicContentCache({ articleId: articleIds['wiki-index'] })
      invalidatePublicContentCache({ articleId: articleIds['wiki-second'] })

      expect(await listPublicArticlesFromDatabase('wiki')).toEqual([])
      expect(await listRestrictedWikiDocumentsFromDatabase()).toEqual([{
        docKey: '2026-07-29-jie-duan-si-ce-shi',
        path: '/wiki/2026-07-29-jie-duan-si-ce-shi',
        title: '阶段四测试',
        date: '2026-07-29'
      }])

      await expect(resolvePublicArticleAccessFromDatabase(
        'news',
        '/news/phase4-test-news',
        false
      )).resolves.toEqual({
        article: null,
        requiresAuthentication: true
      })
      await expect(resolvePublicArticleAccessFromDatabase(
        'news',
        '/news/not-found',
        false
      )).resolves.toEqual({
        article: null,
        requiresAuthentication: false
      })
      await expect(resolvePublicArticleAccessFromDatabase(
        'wiki',
        '/wiki/2026-07-29-jie-duan-si-ce-shi/0100-kai-shi',
        false
      )).resolves.toEqual({
        article: null,
        requiresAuthentication: true
      })

      const authenticated = await getPublicArticleFromDatabase(
        'news',
        '/news/phase4-test-news',
        { includeRestricted: true }
      )
      expect(authenticated).toMatchObject({
        id: articleIds.news,
        requiresAuth: true
      })
      await expect(resolvePublicArticleAccessFromDatabase(
        'news',
        '/news/phase4-test-news',
        true
      )).resolves.toMatchObject({
        article: {
          id: articleIds.news,
          requiresAuth: true
        },
        requiresAuthentication: false
      })
      expect(await listPublicArticlesFromDatabase('news', {
        includeRestricted: true
      })).toHaveLength(1)
      expect(await listPublicArticlesFromDatabase('wiki', {
        includeRestricted: true
      })).toHaveLength(3)
      expect(await searchPublicArticlesFromDatabase(
        '机器人',
        undefined,
        { includeRestricted: true }
      )).toHaveLength(1)

      const [sitemap, rss] = await Promise.all([
        buildPublicDatabaseSitemap(),
        buildPublicDatabaseRss()
      ])
      expect(sitemap).not.toContain('phase4-test-news')
      expect(rss).not.toContain('阶段四数据库新闻')
    } finally {
      await getDatabase().update(articles)
        .set({ requiresAuth: false })
        .where(eq(articles.id, articleIds.news!))
      await getDatabase().update(articles)
        .set({ requiresAuth: false })
        .where(eq(articles.id, articleIds['wiki-first']!))
      await getDatabase().update(articles)
        .set({ requiresAuth: false })
        .where(eq(articles.id, articleIds['wiki-index']!))
      await getDatabase().update(articles)
        .set({ requiresAuth: false })
        .where(eq(articles.id, articleIds['wiki-second']!))
      invalidatePublicContentCache({ articleId: articleIds.news })
      invalidatePublicContentCache({ articleId: articleIds['wiki-first'] })
      invalidatePublicContentCache({ articleId: articleIds['wiki-index'] })
      invalidatePublicContentCache({ articleId: articleIds['wiki-second'] })
    }
  })

  it('缓存可按集合、文章与 Revision 精确失效且有容量和 TTL 上限', async () => {
    invalidatePublicContentCache()
    await getPublicArticleFromDatabase('news', '/news/phase4-test-news')
    expect(getPublicContentCacheStats()).toMatchObject({
      entries: 1,
      maxEntries: 512,
      ttlMilliseconds: 300_000
    })
    expect(invalidatePublicContentCache({
      collection: 'news',
      articleId: articleIds.news,
      revisionId: revisionIds.news
    })).toEqual({ removed: 1, remaining: 0 })
  })

  it('前台和 CMS 最终预览复用 VinciMarkdownRenderer，发布事务未接缓存接口', async () => {
    const [
      newsPage,
      wikiPage,
      memberPage,
      cmsDraftPage,
      publishingService,
      publicContentComposable
    ] = await Promise.all([
      readFile('app/pages/news/[slug].vue', 'utf8'),
      readFile('app/pages/wiki/[...slug].vue', 'utf8'),
      readFile('app/pages/team/[slug].vue', 'utf8'),
      readFile('app/pages/cms/drafts/[id].vue', 'utf8'),
      readFile('server/services/cms-publishing.ts', 'utf8'),
      readFile('app/composables/usePublicContentQuery.ts', 'utf8')
    ])
    for (const source of [newsPage, wikiPage, memberPage, cmsDraftPage]) {
      expect(source).toContain('VinciMarkdownRenderer')
    }
    expect(publishingService).not.toContain('invalidatePublicContentCache')
    expect(publishingService).not.toContain('/content-cache/invalidate')
    expect(publicContentComposable).not.toContain('Promise.allSettled')
    expect(publicContentComposable).not.toContain('nuxt_content')
    expect(publicContentComposable).not.toContain('legacy')
    expect(publicContentComposable).toContain('options.database(requestFetch)')
  })
})
