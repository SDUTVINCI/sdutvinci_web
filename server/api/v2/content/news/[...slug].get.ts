import { createError, getRouterParam } from 'h3'
import { PUBLIC_ARTICLE_AUTH_REQUIRED_CODE } from '../../../../../shared/utils/public-article-access'
import { resolvePublicArticleAccessFromDatabase } from '../../../../services/public-content'
import { getCmsRequestAuth } from '../../../../utils/cms-http'

export default defineEventHandler(async (event) => {
  const slug = decodeURIComponent(String(getRouterParam(event, 'slug') || ''))
  const auth = await getCmsRequestAuth(event)
  const { article, requiresAuthentication } = await resolvePublicArticleAccessFromDatabase(
    'news',
    `/news/${slug}`,
    Boolean(auth)
  )
  if (requiresAuthentication) {
    throw createError({
      statusCode: 401,
      message: '请先登录后查看这篇新闻',
      data: { code: PUBLIC_ARTICLE_AUTH_REQUIRED_CODE }
    })
  }
  if (!article) {
    throw createError({ statusCode: 404, message: '新闻不存在' })
  }
  return { item: article }
})
