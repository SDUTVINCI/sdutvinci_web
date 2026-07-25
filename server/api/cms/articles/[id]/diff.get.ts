import { getQuery, getRouterParam } from 'h3'
import { z } from 'zod'
import { diffCmsArticleVersions } from '../../../../services/cms-publishing-history'
import { requireCmsRequestAuth } from '../../../../utils/cms-http'
import { throwCmsWorkflowError } from '../../../../utils/cms-workflow-http'

const schema = z.object({
  from: z.string().regex(/^[0-9a-f]{7,64}$/),
  to: z.string().regex(/^[0-9a-f]{7,64}$/)
})

export default defineEventHandler(async (event) => {
  await requireCmsRequestAuth(event)
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const query = schema.parse(getQuery(event))
  try {
    return {
      diff: await diffCmsArticleVersions(id, query.from, query.to)
    }
  } catch (error) {
    throwCmsWorkflowError(error)
  }
})
