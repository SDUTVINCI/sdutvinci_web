import { readValidatedBody } from 'h3'
import { z } from 'zod'
import { invalidatePublicContentCache } from '../../../../services/public-content-cache'
import {
  requireCmsCsrf,
  requireCmsRequestAuth
} from '../../../../utils/cms-http'

const schema = z.object({
  collection: z.enum(['news', 'wiki']).optional(),
  articleId: z.string().uuid().optional(),
  revisionId: z.string().uuid().optional()
}).strict()

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event, 'admin')
  requireCmsCsrf(event, auth)
  const input = await readValidatedBody(event, schema.parse)
  return {
    result: invalidatePublicContentCache(input)
  }
})
