import { createError, getRouterParam } from 'h3'
import { getPublicArticleFromDatabase } from '../../../../services/public-content'
import { getCmsRequestAuth } from '../../../../utils/cms-http'

export default defineEventHandler(async (event) => {
  const slug = decodeURIComponent(String(getRouterParam(event, 'slug') || ''))
  const auth = await getCmsRequestAuth(event)
  const article = await getPublicArticleFromDatabase('wiki', `/wiki/${slug}`, {
    includeRestricted: Boolean(auth)
  })
  if (!article) {
    throw createError({ statusCode: 404, message: 'Wiki 页面不存在' })
  }
  return { item: article }
})
