import { getRouterParam } from 'h3'
import { z } from 'zod'
import { getCmsArticleRevision } from '../../../../../services/cms-revisions'
import { requireCmsRequestAuth } from '../../../../../utils/cms-http'
import { requireCmsRevisionShadowApi } from '../../../../../utils/cms-v2-http'
import { throwCmsWorkflowError } from '../../../../../utils/cms-workflow-http'

export default defineEventHandler(async (event) => {
  await requireCmsRequestAuth(event)
  requireCmsRevisionShadowApi()
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const revisionId = z.string().uuid().parse(getRouterParam(event, 'revision'))
  try {
    return { revision: await getCmsArticleRevision(id, revisionId) }
  } catch (error) {
    throwCmsWorkflowError(error)
  }
})
