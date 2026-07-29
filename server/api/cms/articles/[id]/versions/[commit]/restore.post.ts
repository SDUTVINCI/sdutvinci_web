import { getRouterParam } from 'h3'
import { z } from 'zod'
import { restoreCmsArticleVersion } from '../../../../../../services/cms-publishing-history'
import {
  requireCmsCsrf,
  requireCmsRequestAuth
} from '../../../../../../utils/cms-http'
import { throwCmsWorkflowError } from '../../../../../../utils/cms-workflow-http'

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event, 'admin')
  requireCmsCsrf(event, auth)
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const commit = z.union([
    z.string().uuid(),
    z.string().regex(/^[0-9a-f]{7,64}$/)
  ]).parse(getRouterParam(event, 'commit'))
  try {
    return {
      result: await restoreCmsArticleVersion(id, commit, auth.user.id)
    }
  } catch (error) {
    throwCmsWorkflowError(error)
  }
})
