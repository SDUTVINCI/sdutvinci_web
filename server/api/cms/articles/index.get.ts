import { createError, getValidatedQuery } from 'h3'
import { z } from 'zod'
import { listCmsArticles } from '../../../services/cms-articles'
import { requireCmsRequestAuth } from '../../../utils/cms-http'

const schema = z.object({
  q: z.string().trim().max(100).optional(),
  collection: z.enum(['news', 'wiki']).optional(),
  directory: z.string().trim().max(500).optional(),
  status: z.enum(['published', 'deleted', 'all']).optional()
})

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event)
  const query = await getValidatedQuery(event, schema.parse)
  const isAdmin = auth.user.roles.includes('admin')
  if ((query.status === 'deleted' || query.status === 'all') && !isAdmin) {
    throw createError({ statusCode: 403, message: '只有管理员可以查看已删除文章' })
  }
  return listCmsArticles({
    query: query.q,
    collection: query.collection,
    directory: query.directory,
    status: query.status,
    includeDeleted: isAdmin && query.status === 'all'
  })
})
