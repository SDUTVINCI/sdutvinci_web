import { getRouterParam } from 'h3'
import { z } from 'zod'
import { restoreCmsArticleRevision } from '../../../../../../services/cms-publishing-history'
import {
  requireCmsCsrf,
  requireCmsRequestAuth
} from '../../../../../../utils/cms-http'
import { requireCmsRevisionShadowApi } from '../../../../../../utils/cms-v2-http'
import { throwCmsWorkflowError } from '../../../../../../utils/cms-workflow-http'

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event, 'admin')
  requireCmsCsrf(event, auth)
  requireCmsRevisionShadowApi()
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const revisionId = z.string().uuid().parse(getRouterParam(event, 'revision'))
  try {
    return {
      result: await restoreCmsArticleRevision(id, revisionId, auth.user.id)
    }
  } catch (error) {
    throwCmsWorkflowError(error)
  }
})
