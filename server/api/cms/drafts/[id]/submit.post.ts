import { getRouterParam, readValidatedBody } from 'h3'
import { z } from 'zod'
import { submitCmsDraftForReview } from '../../../../services/cms-reviews'
import {
  requireCmsCsrf,
  requireCmsRequestAuth
} from '../../../../utils/cms-http'
import { throwCmsWorkflowError } from '../../../../utils/cms-workflow-http'

const schema = z.object({
  version: z.number().int().positive(),
  lockLeaseId: z.string().uuid()
}).strict()

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event)
  requireCmsCsrf(event, auth)
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const input = await readValidatedBody(event, schema.parse)
  try {
    return {
      draft: await submitCmsDraftForReview(id, auth.user.id, input)
    }
  } catch (error) {
    throwCmsWorkflowError(error)
  }
})
