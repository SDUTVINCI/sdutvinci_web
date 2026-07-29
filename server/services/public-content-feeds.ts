import { listPublicArticlesFromDatabase, listPublicMembersFromDatabase } from './public-content'

const xmlEscape = (value: unknown) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll('\'', '&apos;')

const publicSiteUrl = () => {
  const configured = String(
    Reflect.get(process.env, 'NUXT_PUBLIC_SITE_URL') || 'http://localhost:3000'
  ).trim()
  return configured.replace(/\/+$/, '')
}

export const buildPublicDatabaseSitemap = async () => {
  const [news, wiki, members] = await Promise.all([
    listPublicArticlesFromDatabase('news'),
    listPublicArticlesFromDatabase('wiki'),
    listPublicMembersFromDatabase()
  ])
  const staticPaths = [
    '/',
    '/research',
    '/team',
    '/news',
    '/wiki',
    '/projects',
    '/recruitment',
    '/contact'
  ]
  const paths = new Set([
    ...staticPaths,
    ...news.map(item => item.path),
    ...wiki.map(item => item.path),
    ...members.map(item => item.path)
  ])
  const base = publicSiteUrl()
  const entries = [...paths]
    .sort()
    .map(path => `  <url><loc>${xmlEscape(`${base}${path}`)}</loc></url>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
    + `${entries}\n</urlset>\n`
}

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
