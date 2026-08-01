import { setResponseHeader } from 'h3'
import { buildPublicDatabaseRss } from '../services/public-content-feeds'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'content-type', 'application/rss+xml; charset=utf-8')
  setResponseHeader(event, 'cache-control', 'no-store')
  return buildPublicDatabaseRss()
})
