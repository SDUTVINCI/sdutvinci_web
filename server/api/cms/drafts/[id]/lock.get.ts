import { getRouterParam } from 'h3'
import { z } from 'zod'
import { getCmsDraftEditLock } from '../../../../services/cms-edit-locks'
import { requireCmsRequestAuth } from '../../../../utils/cms-http'
import { throwCmsWorkflowError } from '../../../../utils/cms-workflow-http'

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event)
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  try {
    return {
      lock: await getCmsDraftEditLock(
        id,
        auth.user.id,
        auth.user.roles.includes('admin')
      )
    }
  } catch (error) {
    throwCmsWorkflowError(error)
  }
})
