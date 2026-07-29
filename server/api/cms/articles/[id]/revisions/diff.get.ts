import { getQuery, getRouterParam } from 'h3'
import { z } from 'zod'
import { diffCmsArticleRevisions } from '../../../../../services/cms-revisions'
import { requireCmsRequestAuth } from '../../../../../utils/cms-http'
import { requireCmsRevisionShadowApi } from '../../../../../utils/cms-v2-http'
import { throwCmsWorkflowError } from '../../../../../utils/cms-workflow-http'

const querySchema = z.object({
  from: z.string().uuid(),
  to: z.string().uuid()
}).strict()

export default defineEventHandler(async (event) => {
  await requireCmsRequestAuth(event)
  requireCmsRevisionShadowApi()
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const query = querySchema.parse(getQuery(event))
  try {
    return {
      diff: await diffCmsArticleRevisions(id, query.from, query.to)
    }
  } catch (error) {
    throwCmsWorkflowError(error)
  }
})
