import { requireSiteRequestAuth } from '../utils/cms-http'
import { createError, getQuery, setResponseHeader } from 'h3'
import { listPublicDownloads, PublicDownloadsError } from '../services/public-downloads'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'cache-control', 'private, no-store')
  setResponseHeader(event, 'vary', 'Cookie')
  await requireSiteRequestAuth(event)
  const query = getQuery(event)
  try {
    const result = await listPublicDownloads(query.path, query.page)
    return result
  } catch (error) {
    if (error instanceof PublicDownloadsError) {
      throw createError({ statusCode: error.statusCode, message: error.message })
    }
    throw error
  }
})
