import { listPublicArticlesFromDatabase, listPublicMembersFromDatabase } from './public-content'
import { PUBLIC_SITE_PAGES, canonicalSiteUrl, resolveSiteOrigin, seoDate } from '../../shared/utils/site-seo'

const xmlEscape = (value: unknown) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll('\'', '&apos;')

const publicSiteUrl = () => resolveSiteOrigin(process.env.NUXT_PUBLIC_SITE_URL)

export const listPublicDatabaseSitemapEntries = async () => {
  const [news, wiki, members] = await Promise.all([
    listPublicArticlesFromDatabase('news'),
    listPublicArticlesFromDatabase('wiki'),
    listPublicMembersFromDatabase()
  ])
  const paths = new Map<string, string | undefined>(PUBLIC_SITE_PAGES.map(page => [page.path, undefined]))
  for (const item of [...news, ...wiki, ...members]) {
    const modified = seoDate(item.updatedAt)
    const previous = paths.get(item.path)
    paths.set(item.path, previous && modified ? [previous, modified].sort().at(-1) : previous || modified)
  }
  // Channel modification dates reflect actual public revisions, never request time.
  for (const [path, items] of [['/news', news], ['/wiki', wiki], ['/team', members]] as const) {
    const dates = items.map(item => seoDate(item.updatedAt)).filter((date): date is string => Boolean(date))
    if (dates.length) paths.set(path, dates.sort().at(-1))
  }
  const base = publicSiteUrl()
  return [...paths].sort(([a], [b]) => a.localeCompare(b)).map(([path, lastmod]) => ({
    loc: canonicalSiteUrl(base, path), lastmod
  }))
}

export const buildPublicDatabaseSitemap = async () => {
  const entries = (await listPublicDatabaseSitemapEntries())
    .map(entry => `  <url><loc>${xmlEscape(entry.loc)}</loc>${entry.lastmod ? `<lastmod>${xmlEscape(entry.lastmod)}</lastmod>` : ''}</url>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
    + `${entries}\n</urlset>\n`
}

export const buildPublicDatabaseSitemapText = async () =>
  `${(await listPublicDatabaseSitemapEntries()).map(entry => entry.loc).join('\n')}\n`

export const buildPublicDatabaseRss = async () => {
  const base = publicSiteUrl()
  const news = await listPublicArticlesFromDatabase('news')
  const items = news.map((item) => {
    const link = `${base}${item.path}`
    const date = typeof item.date === 'string'
      ? new Date(item.date)
      : new Date(item.updatedAt)
    const pubDate = Number.isNaN(date.getTime())
      ? new Date(item.updatedAt).toUTCString()
      : date.toUTCString()
    return [
      '    <item>',
      `      <title>${xmlEscape(item.title)}</title>`,
      `      <link>${xmlEscape(link)}</link>`,
      `      <guid isPermaLink="true">${xmlEscape(link)}</guid>`,
      `      <description>${xmlEscape(item.description)}</description>`,
      `      <pubDate>${xmlEscape(pubDate)}</pubDate>`,
      '    </item>'
    ].join('\n')
  }).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + '<rss version="2.0">\n'
    + '  <channel>\n'
    + '    <title>Vinci 机器人队新闻</title>\n'
    + `    <link>${xmlEscape(`${base}/news`)}</link>\n`
    + '    <description>山东理工大学 Vinci 机器人队新闻动态</description>\n'
    + `${items ? `${items}\n` : ''}`
    + '  </channel>\n'
    + '</rss>\n'
}
