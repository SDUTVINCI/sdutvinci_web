import { createError, setResponseHeader } from 'h3'
import { buildPublicDatabaseRss } from '../services/public-content-feeds'
import { isPublicDatabaseResponseEnabled } from '../utils/public-content-flags'

export default defineEventHandler(async (event) => {
  if (!isPublicDatabaseResponseEnabled('news')) {
    throw createError({ statusCode: 404, message: 'RSS 候选未启用' })
  }
  setResponseHeader(event, 'content-type', 'application/rss+xml; charset=utf-8')
  setResponseHeader(event, 'cache-control', 'no-store')
  return buildPublicDatabaseRss()
})
