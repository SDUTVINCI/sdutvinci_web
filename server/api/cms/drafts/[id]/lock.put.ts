import { getRouterParam, readValidatedBody } from 'h3'
import { z } from 'zod'
import { heartbeatCmsDraftEditLock } from '../../../../services/cms-edit-locks'
import {
  requireCmsCsrf,
  requireCmsRequestAuth
} from '../../../../utils/cms-http'
import { throwCmsWorkflowError } from '../../../../utils/cms-workflow-http'

const schema = z.object({ leaseId: z.string().uuid() }).strict()

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event)
  requireCmsCsrf(event, auth)
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const input = await readValidatedBody(event, schema.parse)
  try {
    return await heartbeatCmsDraftEditLock(id, auth.user.id, input.leaseId)
  } catch (error) {
    throwCmsWorkflowError(error)
  }
})
