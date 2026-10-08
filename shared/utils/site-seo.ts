export const SITE_NAME = '山东理工大学 Vinci 机器人队'
export const DEFAULT_SITE_URL = 'https://vinci.sdut.edu.cn'
export const SITE_DESCRIPTION = '山东理工大学 Vinci 机器人队官网，围绕全国大学生机器人大赛 ROBOCON，展示赛事成果、团队成员、招新指南与机器人开发 Wiki。'
export const SITE_LOGO = 'https://cdn.sdutvinci.cn/site-assets/images/logo-e355a71c.webp'
export const SITE_SHARE_IMAGE = 'https://cdn.sdutvinci.cn/site-assets/images/background-6c09ec06.webp'

export const PUBLIC_SITE_PAGES = [
  { path: '/', name: '首页' },
  { path: '/research', name: '赛事成果' },
  { path: '/team', name: '团队成员' },
  { path: '/team/organization', name: '组织架构' },
  { path: '/news', name: '新闻动态' },
  { path: '/wiki', name: 'Wiki 知识库' },
  { path: '/recruitment', name: '招新指南' },
  { path: '/links', name: '常用链接' },
  { path: '/downloads', name: '资料下载' },
  { path: '/contact', name: '联系我们' }
] as const

export interface SeoBreadcrumb {
  name: string
  path: string
}

export const resolveSiteOrigin = (configured: unknown, fallback = DEFAULT_SITE_URL): string => {
  for (const candidate of [configured, fallback, DEFAULT_SITE_URL]) {
    try {
      const url = new URL(String(candidate || '').trim())
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) {
        return url.origin
      }
    } catch { /* Try the next origin. */ }
  }
  return DEFAULT_SITE_URL
}

export const resolveBaiduSiteVerification = (configured: unknown, origin: string): string => {
  const override = String(configured || '').trim()
  // This public ownership tag belongs only to the official HTTPS site.
  return override || (origin === DEFAULT_SITE_URL ? 'codeva-FERDraaDA8' : '')
}

export const canonicalSiteUrl = (origin: string, path: string): string => {
  // Public paths must stay on the configured site, even when supplied by content.
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
    throw new Error('SEO_PUBLIC_PATH_INVALID')
  }
  const url = new URL(path, resolveSiteOrigin(origin))
  url.search = ''
  url.hash = ''
  url.pathname = url.pathname.replace(/\/+$/, '') || '/'
  return url.toString()
}

export const seoDescription = (value: unknown, fallback = SITE_DESCRIPTION): string => {
  const clean = String(value || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(^|\n)\s*#{1,6}\s+/g, '$1')
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, entity => ({
      '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' '
    })[entity] || entity)
    .replace(/\s+/g, ' ')
    .trim()
  return Array.from(clean || fallback).slice(0, 160).join('')
}

export const seoDate = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) return undefined
  const date = new Date(value)
  const day = new Date(`${value.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(date.getTime()) || Number.isNaN(day.getTime())
    || day.toISOString().slice(0, 10) !== value.slice(0, 10)) return undefined
  return date.toISOString()
}

export const serializeSeoJson = (value: unknown): string => JSON.stringify(value)
  .replace(/</g, '\\u003c')
  .replace(/>/g, '\\u003e')
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029')

export interface SeoGraphInput {
  origin: string
  path: string
  title: string
  description: string
  image?: string
  breadcrumbs?: SeoBreadcrumb[]
  articleKind?: 'NewsArticle' | 'TechArticle'
  headline?: string
  publishedAt?: unknown
  modifiedAt?: unknown
  author?: string
}

export const buildSeoGraph = (input: SeoGraphInput) => {
  const origin = resolveSiteOrigin(input.origin)
  const canonical = canonicalSiteUrl(origin, input.path)
  const organizationId = `${origin}/#organization`
  const websiteId = `${origin}/#website`
  const pageId = `${canonical}#webpage`
  const graph: Record<string, unknown>[] = [
    {
      '@type': 'Organization', '@id': organizationId,
      name: SITE_NAME,
      alternateName: ['Vinci机器人队', '山理工 Vinci 机器人队', 'SDUT Vinci'],
      url: `${origin}/`, logo: SITE_LOGO,
      description: SITE_DESCRIPTION,
      parentOrganization: {
        '@type': 'CollegeOrUniversity', name: '山东理工大学', url: 'https://www.sdut.edu.cn/'
      },
      sameAs: ['https://github.com/SDUTVINCI', 'https://space.bilibili.com/471524675']
    },
    {
      '@type': 'WebSite', '@id': websiteId,
      name: SITE_NAME, alternateName: 'Vinci 机器人队官网',
      url: `${origin}/`, inLanguage: 'zh-CN',
      publisher: { '@id': organizationId }
    },
    {
      '@type': 'WebPage', '@id': pageId, url: canonical,
      name: input.title, description: input.description, inLanguage: 'zh-CN',
      isPartOf: { '@id': websiteId }, about: { '@id': organizationId }
    }
  ]
  if (input.path !== '/') {
    const page = PUBLIC_SITE_PAGES.find(page => page.path === input.path)
    const supplied = input.breadcrumbs || [{ name: page?.name || input.title, path: input.path }]
    const crumbs = [{ name: '首页', path: '/' }, ...supplied.filter(crumb => crumb.path !== '/')]
    graph.push({
      '@type': 'BreadcrumbList', '@id': `${canonical}#breadcrumb`,
      itemListElement: crumbs.map((crumb, index) => ({
        '@type': 'ListItem', position: index + 1,
        name: crumb.name, item: canonicalSiteUrl(origin, crumb.path)
      }))
    })
    graph[2]!.breadcrumb = { '@id': `${canonical}#breadcrumb` }
  }
  if (input.articleKind) {
    graph.push({
      '@type': input.articleKind, '@id': `${canonical}#article`,
      headline: input.headline || input.title, description: input.description,
      mainEntityOfPage: { '@id': pageId }, inLanguage: 'zh-CN',
      publisher: { '@id': organizationId },
      ...(input.image ? { image: [input.image] } : {}),
      ...(seoDate(input.publishedAt) ? { datePublished: seoDate(input.publishedAt) } : {}),
      ...(seoDate(input.modifiedAt) ? { dateModified: seoDate(input.modifiedAt) } : {}),
      ...(input.author ? { author: { '@type': 'Person', name: input.author } } : {})
    })
  }
  return { '@context': 'https://schema.org', '@graph': graph }
}
