import { createHash } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { parse, type DefaultTreeAdapterMap } from 'parse5'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDatabase, getDatabase } from '../server/db/client'
import { articles, articleRevisions, users } from '../server/db/schema'
import { runMigrations } from '../server/db/migrate'
import { createCmsUser } from '../server/services/cms-auth'
import { configureCmsTestDatabase } from './helpers/cms-test-database'

const base = process.env.SEO_TEST_BASE_URL
const origin = 'https://seo-runtime.example'
const enabled = Boolean(base) && configureCmsTestDatabase()
const integration = enabled ? describe : describe.skip
type Node = DefaultTreeAdapterMap['node']
type Element = DefaultTreeAdapterMap['element']
const elements = (node: Node): Element[] => [
  ...('tagName' in node ? [node] : []),
  ...('childNodes' in node ? node.childNodes.flatMap(elements) : [])
]
const attr = (node: Element, name: string) => node.attrs.find(item => item.name === name)?.value
const text = (node: Node): string => 'value' in node ? node.value
  : 'childNodes' in node ? node.childNodes.map(text).join('') : ''
const metadata = (html: string) => {
  const nodes = elements(parse(html))
  const meta = (name: string) => nodes.filter(node => node.tagName === 'meta'
    && (attr(node, 'name') === name || attr(node, 'property') === name))
  const scripts = nodes.filter(node => node.tagName === 'script' && attr(node, 'type') === 'application/ld+json')
  return {
    nodes, meta,
    title: text(nodes.find(node => node.tagName === 'title')!),
    canonical: nodes.filter(node => node.tagName === 'link' && attr(node, 'rel') === 'canonical'),
    graphs: scripts.map(node => JSON.parse(text(node)))
  }
}

integration('生产构建 SEO HTTP 与权限', () => {
  const ids: string[] = []
  let userId: string | undefined
  let cookie = ''
  const newsPath = '/news/seo-http-test'
  const privatePath = '/news/seo-http-private'
  const wikiRoot = '/wiki/2026-10-07-seo-ce-shi'
  const wikiPath = `${wikiRoot}/0100-control`
  const privateWikiPath = `${wikiRoot}/0200-private`

  const seed = async (input: {
    collection: 'news' | 'wiki'
    path: string
    relativePath: string
    title: string
    requiresAuth?: boolean
  }) => {
    const body = '## 工程实践\n\n机器人 SEO 正文验证，仅用于隔离测试。'
    const hash = createHash('sha256').update(body).digest('hex')
    const [article] = await getDatabase().insert(articles).values({
      collection: input.collection, publicPath: input.path, relativePath: input.relativePath,
      directory: input.relativePath.split('/').slice(0, -1).join('/'),
      title: input.title, searchText: input.title, contentHash: hash,
      requiresAuth: Boolean(input.requiresAuth)
    }).returning()
    ids.push(article!.id)
    const [revision] = await getDatabase().insert(articleRevisions).values({
      articleId: article!.id, revisionNumber: 1, markdownSource: body, body,
      frontmatter: { title: input.title, date: '2026-10-07', tags: ['软件算法组'] },
      contentHash: hash, sourceKind: 'backfill', createdAt: new Date('2026-10-07T01:00:00Z')
    }).returning()
    await getDatabase().update(articles).set({ currentRevisionId: revision!.id }).where(eq(articles.id, article!.id))
  }

  beforeAll(async () => {
    const url = new URL(base!)
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
      throw new Error('SEO_TEST_BASE_URL 必须是本机隔离测试服务')
    }
    // Refuse an unrelated local app before writing any test fixtures.
    const home = metadata(await (await fetch(`${base}/`)).text())
    expect(attr(home.canonical[0]!, 'href')).toBe(`${origin}/`)
    await runMigrations()
    await seed({ collection: 'news', path: newsPath, relativePath: 'seo-http-test.md', title: 'SEO 公共新闻' })
    await seed({ collection: 'news', path: privatePath, relativePath: 'seo-http-private.md', title: 'SEO_PRIVATE_ARTICLE', requiresAuth: true })
    await seed({ collection: 'wiki', path: wikiRoot, relativePath: '2026-10-07-SEO测试/index.md', title: 'SEO 测试文档' })
    await seed({ collection: 'wiki', path: wikiPath, relativePath: '2026-10-07-SEO测试/0100-control.md', title: '控制教程' })
    await seed({ collection: 'wiki', path: privateWikiPath, relativePath: '2026-10-07-SEO测试/0200-private.md', title: 'SEO_PRIVATE_WIKI', requiresAuth: true })
    const user = await createCmsUser({ account: 'seohttptester', password: 'SeoTestPassword123', roles: ['member'] }, null)
    userId = user!.id
    const response = await fetch(`${base}/api/cms/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: base! },
      body: JSON.stringify({ account: 'seohttptester', password: 'SeoTestPassword123' })
    })
    expect(response.status).toBe(200)
    cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    expect(cookie).toContain('vinci_cms_session=')
  })

  afterAll(async () => {
    try {
      if (ids.length) {
        await getDatabase().update(articles).set({ currentRevisionId: null }).where(inArray(articles.id, ids))
        await getDatabase().delete(articleRevisions).where(inArray(articleRevisions.articleId, ids))
        await getDatabase().delete(articles).where(inArray(articles.id, ids))
      }
      if (userId) await getDatabase().delete(users).where(eq(users.id, userId))
    } finally { await closeDatabase() }
  })

  it('核心页面在原始 HTML 中提供唯一的 metadata 和运行时验证代码', async () => {
    const descriptions = new Set<string>()
    for (const path of ['/', '/research', '/recruitment', '/contact', '/links', '/news', '/wiki', '/team', '/team/organization']) {
      const response = await fetch(`${base}${path}`)
      expect(response.status, path).toBe(200)
      const page = metadata(await response.text())
      expect(page.canonical).toHaveLength(1)
      expect(attr(page.canonical[0]!, 'href')).toBe(`${origin}${path}`)
      expect(page.meta('description')).toHaveLength(1)
      const description = attr(page.meta('description')[0]!, 'content')!
      expect(description.length).toBeGreaterThan(10)
      descriptions.add(description)
      expect(page.meta('og:image')).toHaveLength(1)
      expect(attr(page.meta('baidu-site-verification')[0]!, 'content')).toBe('seo-verification-test')
      expect(page.graphs).toHaveLength(1)
      expect(page.graphs[0]['@graph'].map((node: Record<string, unknown>) => node['@type']))
        .toEqual(expect.arrayContaining(['Organization', 'WebSite', 'WebPage']))
      expect(response.headers.get('x-robots-tag')).toBeNull()
    }
    expect(descriptions.size).toBe(9)
  })

  it('新闻与 Wiki 原始正文可抓取，文章与面包屑结构正确', async () => {
    for (const [path, kind] of [[newsPath, 'NewsArticle'], [wikiPath, 'TechArticle']]) {
      const response = await fetch(`${base}${path}`)
      expect(response.status).toBe(200)
      const page = metadata(await response.text())
      const body = page.nodes.find(node => attr(node, 'class')?.includes('vinci-markdown-renderer'))!
      expect(text(body)).toContain('机器人 SEO 正文验证')
      expect(page.graphs[0]['@graph']).toEqual(expect.arrayContaining([
        expect.objectContaining({ '@type': kind, dateModified: '2026-10-07T01:00:00.000Z' }),
        expect.objectContaining({ '@type': 'BreadcrumbList' })
      ]))
      if (kind === 'TechArticle') expect(page.title).toContain('SEO 测试文档')
    }
  })

  it('匿名和已登录 Sitemap 都排除受限文章、后台与占位页面', async () => {
    for (const headers of [{}, { cookie }]) {
      const xml = await (await fetch(`${base}/sitemap.xml`, { headers })).text()
      const list = await (await fetch(`${base}/sitemap.txt`, { headers })).text()
      expect(xml).toContain(`${origin}${newsPath}`)
      expect(xml).toContain('<lastmod>2026-10-07T01:00:00.000Z</lastmod>')
      expect(list).toContain(`${origin}/team/organization`)
      for (const excluded of [privatePath, privateWikiPath, '/cms', '/projects', '/team/apply', '/search']) {
        expect(xml).not.toContain(`${origin}${excluded}`)
        expect(list).not.toContain(`${origin}${excluded}`)
      }
    }
  })

  it('受限详情匿名跳转登录，已登录正文携带 noindex 且不输出文章结构化数据', async () => {
    for (const path of [privatePath, privateWikiPath]) {
      const anonymous = await fetch(`${base}${path}`, { redirect: 'manual' })
      expect([301, 302, 307, 308]).toContain(anonymous.status)
      expect(anonymous.headers.get('location')).toContain('/cms/login')
      expect(await anonymous.text()).not.toContain('SEO_PRIVATE')
      const response = await fetch(`${base}${path}`, { headers: { cookie } })
      expect(response.status).toBe(200)
      const page = metadata(await response.text())
      expect(page.title).toContain('SEO_PRIVATE')
      expect(response.headers.get('x-robots-tag')).toContain('noindex')
      expect(attr(page.meta('robots')[0]!, 'content')).toContain('noindex')
      expect(page.graphs).toHaveLength(0)
    }
  })

  it('非收录页面和真实 404 保留状态与禁止收录标记，旧入口永久跳转', async () => {
    for (const path of ['/cms/login', '/cms', '/projects', '/team/apply', '/search?q=robot']) {
      const response = await fetch(`${base}${path}`)
      expect(response.status).toBe(200)
      expect(response.headers.get('x-robots-tag'), path).toContain('noindex')
      expect(attr(metadata(await response.text()).meta('robots')[0]!, 'content')).toContain('noindex')
    }
    for (const path of ['/does-not-exist-seo-test', '/news/does-not-exist-seo-test', '/wiki/does-not-exist-seo-test']) {
      for (const accept of ['text/html', 'application/json']) {
        const response = await fetch(`${base}${path}`, { headers: { accept } })
        expect(response.status).toBe(404)
        expect(response.headers.get('x-robots-tag'), `${path} (${accept})`).toContain('noindex')
      }
    }
    const docs = await fetch(`${base}/docs`, { redirect: 'manual' })
    expect(docs.status).toBe(301)
    expect(docs.headers.get('location')).toBe('/wiki')
    const robots = await fetch(`${base}/robots.txt`)
    expect(robots.status).toBe(200)
    expect(await robots.text()).toContain(`Sitemap: ${origin}/sitemap.xml`)
  })
})
