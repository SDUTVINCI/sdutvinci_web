import { createError, setResponseHeader } from 'h3'
import { buildPublicDatabaseSitemap } from '../services/public-content-feeds'
import { isPublicDatabaseResponseEnabled } from '../utils/public-content-flags'

export default defineEventHandler(async (event) => {
  if (
    !isPublicDatabaseResponseEnabled('news')
    && !isPublicDatabaseResponseEnabled('wiki')
    && !isPublicDatabaseResponseEnabled('members')
  ) {
    throw createError({ statusCode: 404, message: 'Sitemap 候选未启用' })
  }
  setResponseHeader(event, 'content-type', 'application/xml; charset=utf-8')
  setResponseHeader(event, 'cache-control', 'no-store')
  return buildPublicDatabaseSitemap()
})
