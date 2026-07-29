import { createError, getRouterParam } from 'h3'
import { getPublicArticleFromDatabase } from '../../../../services/public-content'
import { requirePublicDatabaseCandidate } from '../../../../utils/public-content-http'

export default defineEventHandler(async (event) => {
  requirePublicDatabaseCandidate('wiki')
  const slug = decodeURIComponent(String(getRouterParam(event, 'slug') || ''))
  const article = await getPublicArticleFromDatabase('wiki', `/wiki/${slug}`)
  if (!article) {
    throw createError({ statusCode: 404, message: 'Wiki 页面不存在' })
  }
  return { item: article }
})
