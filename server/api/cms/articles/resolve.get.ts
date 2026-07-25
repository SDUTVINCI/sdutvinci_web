import { createError, getValidatedQuery } from 'h3'
import { z } from 'zod'
import { resolveCmsArticleByPublicPath } from '../../../services/cms-articles'

const schema = z.object({
  publicPath: z.string().trim().min(1).max(1000).refine(
    value => /^\/(news|wiki)(\/|$)/.test(value),
    '只允许解析新闻或 Wiki 前台路径'
  )
})

export default defineEventHandler(async (event) => {
  const query = await getValidatedQuery(event, schema.parse)
  const article = await resolveCmsArticleByPublicPath(query.publicPath)
  if (!article) throw createError({ statusCode: 404, message: '文章不存在' })
  return { article }
})
