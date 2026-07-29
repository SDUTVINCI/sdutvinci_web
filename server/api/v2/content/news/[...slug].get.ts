import { createError, getRouterParam } from 'h3'
import { getPublicArticleFromDatabase } from '../../../../services/public-content'
import { requirePublicDatabaseCandidate } from '../../../../utils/public-content-http'

export default defineEventHandler(async (event) => {
  requirePublicDatabaseCandidate('news')
  const slug = decodeURIComponent(String(getRouterParam(event, 'slug') || ''))
  const article = await getPublicArticleFromDatabase('news', `/news/${slug}`)
  if (!article) {
    throw createError({ statusCode: 404, message: '新闻不存在' })
  }
  return { item: article }
})
