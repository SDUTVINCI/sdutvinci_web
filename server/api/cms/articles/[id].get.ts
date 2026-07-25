import { createError, getRouterParam } from 'h3'
import { z } from 'zod'
import { getCmsArticle } from '../../../services/cms-articles'
import { requireCmsRequestAuth } from '../../../utils/cms-http'

export default defineEventHandler(async (event) => {
  await requireCmsRequestAuth(event)
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const article = await getCmsArticle(id)
  if (!article) throw createError({ statusCode: 404, message: '文章不存在' })
  return { article }
})
