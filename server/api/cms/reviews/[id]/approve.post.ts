import { getRouterParam, readValidatedBody } from 'h3'
import { z } from 'zod'
import { approveCmsDraftReview } from '../../../../services/cms-reviews'
import {
  requireCmsCsrf,
  requireCmsRequestAuth
} from '../../../../utils/cms-http'
import { throwCmsWorkflowError } from '../../../../utils/cms-workflow-http'

const schema = z.object({ version: z.number().int().positive() }).strict()

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event, 'admin')
  requireCmsCsrf(event, auth)
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const input = await readValidatedBody(event, schema.parse)
  try {
    return {
      draft: await approveCmsDraftReview(id, auth.user.id, input.version)
    }
  } catch (error) {
    throwCmsWorkflowError(error)
  }
})
