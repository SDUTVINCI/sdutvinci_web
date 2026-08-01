import { setResponseHeader } from 'h3'
import { buildPublicDatabaseSitemap } from '../services/public-content-feeds'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'content-type', 'application/xml; charset=utf-8')
  setResponseHeader(event, 'cache-control', 'no-store')
  return buildPublicDatabaseSitemap()
})
