import { getValidatedQuery } from 'h3'
import { z } from 'zod'
import { listCmsArticles } from '../../../services/cms-articles'
import { requireCmsRequestAuth } from '../../../utils/cms-http'

const schema = z.object({
  q: z.string().trim().max(100).optional(),
  collection: z.enum(['news', 'wiki']).optional(),
  directory: z.string().trim().max(500).optional()
})

export default defineEventHandler(async (event) => {
  await requireCmsRequestAuth(event)
  const query = await getValidatedQuery(event, schema.parse)
  return listCmsArticles({
    query: query.q,
    collection: query.collection,
    directory: query.directory
  })
})
