import { getRequestURL, setResponseHeader } from 'h3'

export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname.replace(/\/+$/, '') || '/'
  if (path === '/cms' || path.startsWith('/cms/') || path === '/api' || path.startsWith('/api/')) {
    setResponseHeader(event, 'X-Robots-Tag', 'noindex, nofollow')
  } else if (['/__nuxt_error', '/search', '/projects', '/team/apply', '/sitemap.xml', '/sitemap.txt', '/rss.xml', '/robots.txt'].includes(path)) {
    setResponseHeader(event, 'X-Robots-Tag', 'noindex, follow')
  }
})
