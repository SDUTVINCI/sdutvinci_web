import { getRouterParam } from 'h3'
import { z } from 'zod'
import { listCmsArticleRevisions } from '../../../../../services/cms-revisions'
import { requireCmsRequestAuth } from '../../../../../utils/cms-http'
import { requireCmsRevisionShadowApi } from '../../../../../utils/cms-v2-http'
import { throwCmsWorkflowError } from '../../../../../utils/cms-workflow-http'

export default defineEventHandler(async (event) => {
  await requireCmsRequestAuth(event)
  requireCmsRevisionShadowApi()
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  try {
    return { revisions: await listCmsArticleRevisions(id) }
  } catch (error) {
    throwCmsWorkflowError(error)
  }
})
