import { createError, getQuery } from 'h3'
import { z } from 'zod'
import type { PublicArticleCollection } from '../../../../shared/types/public-content'
import { searchPublicArticlesFromDatabase } from '../../../services/public-content'

const querySchema = z.object({
  q: z.string().trim().min(1).max(200),
  collection: z.enum(['news', 'wiki']).optional()
})

export default defineEventHandler(async (event) => {
  const parsed = querySchema.safeParse(getQuery(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, message: '搜索参数无效' })
  }
  const collection = parsed.data.collection as PublicArticleCollection | undefined
  return {
    items: await searchPublicArticlesFromDatabase(parsed.data.q, collection)
  }
})
