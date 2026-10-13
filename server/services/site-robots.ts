import { resolveSiteOrigin } from '../../shared/utils/site-seo'

export const buildSiteRobots = (configuredOrigin: unknown) => [
  'User-agent: *',
  'Allow: /',
  'Disallow: /api/',
  '',
  // CMS, search and placeholder pages remain crawlable so their noindex can be read.
  `Sitemap: ${resolveSiteOrigin(configuredOrigin)}/sitemap.xml`,
  ''
].join('\n')
