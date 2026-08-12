import { readValidatedBody } from 'h3'
import { z } from 'zod'
import { CMS_BATCH_SUBMIT_CONFIRMATION } from '../../../../shared/types/cms-drafts'
import { batchSubmitCmsDraftsForReview } from '../../../services/cms-batch-workflow'
import { requireCmsCsrf, requireCmsRequestAuth } from '../../../utils/cms-http'

const schema = z.object({
  items: z.array(z.object({
    id: z.string().uuid(),
    version: z.number().int().positive()
  }).strict()).min(1).max(100),
  confirm: z.literal(CMS_BATCH_SUBMIT_CONFIRMATION)
}).strict()

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event)
  requireCmsCsrf(event, auth)
  const input = await readValidatedBody(event, schema.parse)
  return { results: await batchSubmitCmsDraftsForReview(input.items, auth.user.id) }
})
