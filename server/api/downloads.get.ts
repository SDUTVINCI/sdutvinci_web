import { createError, getQuery, setResponseHeader } from 'h3'
import { listPublicDownloads, PublicDownloadsError } from '../services/public-downloads'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  try {
    const result = await listPublicDownloads(query.path, query.page)
    setResponseHeader(event, 'cache-control', 'public, max-age=30, s-maxage=60')
    return result
  } catch (error) {
    if (error instanceof PublicDownloadsError) {
      throw createError({ statusCode: error.statusCode, message: error.message })
    }
    throw error
  }
})
