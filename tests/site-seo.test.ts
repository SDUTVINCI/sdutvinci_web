import { parseFragment } from 'parse5'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SITE_URL, buildSeoGraph, canonicalSiteUrl,
  resolveSiteOrigin, seoDate, seoDescription, serializeSeoJson
} from '../shared/utils/site-seo'
import { buildSiteRobots } from '../server/services/site-robots'

describe('官网 SEO 元数据', () => {
  it('只使用 HTTP(S) origin，规范化参数、锚点和中文路径', () => {
    expect(resolveSiteOrigin('https://vinci.example/base/')).toBe('https://vinci.example')
    expect(resolveSiteOrigin('javascript:alert(1)')).toBe(DEFAULT_SITE_URL)
    expect(resolveSiteOrigin('https://user:password@example.com')).toBe(DEFAULT_SITE_URL)
    expect(canonicalSiteUrl('https://vinci.example', '/wiki/机器人/?q=1#intro'))
      .toBe('https://vinci.example/wiki/%E6%9C%BA%E5%99%A8%E4%BA%BA')
    for (const path of ['//other.example/article', '/\\other.example', 'https://other.example/']) {
      expect(() => canonicalSiteUrl(DEFAULT_SITE_URL, path)).toThrow('SEO_PUBLIC_PATH_INVALID')
    }
  })

  it('清理摘要的 HTML、Markdown 和换行，并保留合法日期与 Unicode', () => {
    expect(seoDescription('# 机器人\n\n[教程](/wiki) <br> A &amp; B'))
      .toBe('机器人 教程 A & B')
    expect(Array.from(seoDescription('🤖'.repeat(200)))).toHaveLength(160)
    expect(seoDate('2026-10-07')).toBe('2026-10-07T00:00:00.000Z')
    expect(seoDate('2026-10-07T00:30:00+08:00')).toBe('2026-10-06T16:30:00.000Z')
    expect(seoDate('2026-02-30')).toBeUndefined()
    expect(seoDate('未标注')).toBeUndefined()
  })

  it('结构化数据引用同一官网和发布者，面包屑反映文档层级，日期不伪造', () => {
    const graph = buildSeoGraph({
      origin: 'https://runtime.example', path: '/wiki/robot/control',
      title: '控制教程', description: '机器人控制实践', articleKind: 'TechArticle',
      publishedAt: '无日期', modifiedAt: '2026-10-07T01:00:00Z',
      breadcrumbs: [
        { name: 'Wiki 知识库', path: '/wiki' },
        { name: '机器人开发', path: '/wiki/robot' },
        { name: '控制教程', path: '/wiki/robot/control' }
      ]
    })['@graph']
    const article = graph.find(node => node['@type'] === 'TechArticle')!
    expect(article).not.toHaveProperty('datePublished')
    expect(article.dateModified).toBe('2026-10-07T01:00:00.000Z')
    expect(article.publisher).toEqual({ '@id': 'https://runtime.example/#organization' })
    const breadcrumb = graph.find(node => node['@type'] === 'BreadcrumbList')!
    expect(breadcrumb.itemListElement).toMatchObject([
      { position: 1, name: '首页' }, { position: 2, name: 'Wiki 知识库' },
      { position: 3, name: '机器人开发' }, { position: 4, name: '控制教程' }
    ])
  })

  it('内容中的 script 结束标签无法注入额外 DOM，JSON 仍可解析', () => {
    const value = { headline: '</script><img src=x onerror=alert(1)>\u2028' }
    const serialized = serializeSeoJson(value)
    expect(JSON.parse(serialized)).toEqual(value)
    const fragment = parseFragment(`<script type="application/ld+json">${serialized}</script>`)
    expect(fragment.childNodes).toHaveLength(1)
    expect(fragment.childNodes[0]).toHaveProperty('nodeName', 'script')
  })

  it('robots 声明运行域名的 Sitemap，允许页面和渲染资源抓取', () => {
    const robots = buildSiteRobots('https://runtime.example/')
    expect(robots).toContain('Sitemap: https://runtime.example/sitemap.xml')
    expect(robots).toContain('Disallow: /api/')
    expect(robots).not.toMatch(/Disallow: \/(?:cms|search|_nuxt|wiki)/)
    expect(buildSiteRobots(undefined)).not.toContain('localhost')
  })
})
