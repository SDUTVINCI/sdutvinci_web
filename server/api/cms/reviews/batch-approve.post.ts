import { readValidatedBody } from 'h3'
import { z } from 'zod'
import { CMS_BATCH_APPROVE_CONFIRMATION } from '../../../../shared/types/cms-drafts'
import { batchApproveCmsDrafts } from '../../../services/cms-batch-workflow'
import { requireCmsCsrf, requireCmsRequestAuth } from '../../../utils/cms-http'

const schema = z.object({
  items: z.array(z.object({ id: z.string().uuid(), version: z.number().int().positive() }).strict()).min(1).max(100),
  confirm: z.literal(CMS_BATCH_APPROVE_CONFIRMATION)
}).strict()

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event, 'admin')
  requireCmsCsrf(event, auth)
  const input = await readValidatedBody(event, schema.parse)
  return { results: await batchApproveCmsDrafts(input.items, auth.user.id) }
})
