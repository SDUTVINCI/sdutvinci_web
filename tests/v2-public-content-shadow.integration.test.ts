import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDatabase, getDatabase } from '../server/db/client'
import { runMigrations } from '../server/db/migrate'
import {
  articleRevisions,
  articles,
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
  searchPublicArticlesFromDatabase
} from '../server/services/public-content'
import {
  createPublicRevisionCacheKey,
  getPublicContentCacheStats,
  invalidatePublicContentCache
} from '../server/services/public-content-cache'
import {
  getPublicContentSourceConfig,
  PublicContentConfigurationError
} from '../server/utils/public-content-flags'
import { compareWikiChapters, numberWikiChapters } from '../utils/wiki-chapters'
import { configureCmsTestDatabase } from './helpers/cms-test-database'

const enabled = configureCmsTestDatabase()
const databaseSuite = enabled ? describe : describe.skip
const hash = (source: string) =>
  createHash('sha256').update(source).digest('hex')
const sourceEnvironmentKeys = [
  'CONTENT_SOURCE_NEWS',
  'CONTENT_SOURCE_WIKI',
  'CONTENT_SOURCE_MEMBERS',
  'CONTENT_CANDIDATE_ENV',
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

describe('V2 阶段 4 内容来源开关', () => {
  afterAll(restoreEnvironment)

  it('默认保持 legacy_git，候选环境默认关闭', () => {
    for (const key of sourceEnvironmentKeys) delete process.env[key]
    expect(getPublicContentSourceConfig()).toEqual({
      environment: 'disabled',
      sources: {
        news: 'legacy_git',
        wiki: 'legacy_git',
        members: 'legacy_git'
      }
    })
    expect(getCmsArticlePublicPath(
      'news',
      '2024-07-06-接受赛委会采访.md'
    )).toBe('/news/2024-07-06')
  })

  it('数据库候选只允许显式 test/staging，错误配置 fail closed', () => {
    process.env.CONTENT_SOURCE_NEWS = 'database'
    process.env.CONTENT_CANDIDATE_ENV = 'disabled'
    expect(() => getPublicContentSourceConfig())
      .toThrow(PublicContentConfigurationError)

    process.env.CONTENT_CANDIDATE_ENV = 'test'
    process.env.NODE_ENV = 'production'
    expect(() => getPublicContentSourceConfig())
      .toThrow('只允许在 NODE_ENV=test')

    process.env.CONTENT_CANDIDATE_ENV = 'staging'
    process.env.CONTENT_SOURCE_NEWS = 'database'
    process.env.CONTENT_SOURCE_WIKI = 'database_shadow'
    process.env.CONTENT_SOURCE_MEMBERS = 'legacy_git'
    expect(getPublicContentSourceConfig()).toMatchObject({
      environment: 'staging',
      sources: {
        news: 'database',
        wiki: 'database_shadow',
        members: 'legacy_git'
      }
    })
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
      truncate table rate_limit_buckets, content_export_jobs, article_deletion_events, publish_records, edit_locks,
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
    await getDatabase().insert(members).values({
      memberKey: 'phase4-member',
      name: '阶段四成员',
      avatarUrl: '/images/logo.png',
      sourcePath: '2018/王虓.md',
      metadata: {
        role: '控制组',
        time: '2026',
        links: { github: 'https://example.test/phase4' }
      }
    })
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

  it('成员候选保持数据库结构化读取，详情只读复用 legacy 正文', async () => {
    const list = await listPublicMembersFromDatabase()
    expect(list).toMatchObject([{
      memberKey: 'phase4-member',
      name: '阶段四成员',
      role: '控制组',
      body: ''
    }])
    const detail = await getPublicMemberFromDatabase('phase4-member')
    expect(detail?.body.length).toBeGreaterThan(0)
    expect(await getPublicMemberFromDatabase('阶段四成员')).toMatchObject({
      memberKey: 'phase4-member'
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
      '<loc>https://phase4.test/team/phase4-member</loc>'
    )
    expect(sitemap).not.toContain('phase4-test-deleted')
    expect(rss).toContain('<title>阶段四数据库新闻</title>')
    expect(rss).not.toContain('已删除候选')
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
    expect(publicContentComposable).toContain('Promise.allSettled')
    expect(publicContentComposable).toContain('renderer: \'nuxt_content\'')
    expect(publicContentComposable).toContain('legacyResult.value')
  })
})
