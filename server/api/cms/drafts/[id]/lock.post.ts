import { getRouterParam } from 'h3'
import { z } from 'zod'
import { acquireCmsDraftEditLock } from '../../../../services/cms-edit-locks'
import {
  requireCmsCsrf,
  requireCmsRequestAuth
} from '../../../../utils/cms-http'
import { throwCmsWorkflowError } from '../../../../utils/cms-workflow-http'

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event)
  requireCmsCsrf(event, auth)
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  try {
    return await acquireCmsDraftEditLock(
      id,
      auth.user.id,
      auth.user.roles.includes('admin')
    )
  } catch (error) {
    throwCmsWorkflowError(error)
  }
})
