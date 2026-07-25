import { getRouterParam, readValidatedBody } from 'h3'
import { z } from 'zod'
import { publishCmsDraft } from '../../../../services/cms-publishing'
import {
  requireCmsCsrf,
  requireCmsRequestAuth
} from '../../../../utils/cms-http'
import { throwCmsWorkflowError } from '../../../../utils/cms-workflow-http'

const schema = z.object({
  version: z.number().int().positive(),
  relativePath: z.string().trim().max(500).optional()
}).strict()

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event, 'admin')
  requireCmsCsrf(event, auth)
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const input = await readValidatedBody(event, schema.parse)
  try {
    return { result: await publishCmsDraft(id, auth.user.id, input) }
  } catch (error) {
    throwCmsWorkflowError(error)
  }
})
