import { getRouterParam } from 'h3'
import { z } from 'zod'
import { listCmsArticleHistory } from '../../../../services/cms-publishing-history'
import { requireCmsRequestAuth } from '../../../../utils/cms-http'
import { throwCmsWorkflowError } from '../../../../utils/cms-workflow-http'

export default defineEventHandler(async (event) => {
  await requireCmsRequestAuth(event)
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  try {
    return { history: await listCmsArticleHistory(id) }
  } catch (error) {
    throwCmsWorkflowError(error)
  }
})
