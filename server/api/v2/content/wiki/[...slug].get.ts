import { createError, getRouterParam } from 'h3'
import { getPublicArticleFromDatabase } from '../../../../services/public-content'

export default defineEventHandler(async (event) => {
  const slug = decodeURIComponent(String(getRouterParam(event, 'slug') || ''))
  const article = await getPublicArticleFromDatabase('wiki', `/wiki/${slug}`)
  if (!article) {
    throw createError({ statusCode: 404, message: 'Wiki 页面不存在' })
  }
  return { item: article }
})
