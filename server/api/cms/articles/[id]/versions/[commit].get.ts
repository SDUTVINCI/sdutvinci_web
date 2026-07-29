import { getRouterParam } from 'h3'
import { z } from 'zod'
import { getCmsArticleVersion } from '../../../../../services/cms-publishing-history'
import { requireCmsRequestAuth } from '../../../../../utils/cms-http'
import { throwCmsWorkflowError } from '../../../../../utils/cms-workflow-http'

export default defineEventHandler(async (event) => {
  await requireCmsRequestAuth(event)
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const commit = z.union([
    z.string().uuid(),
    z.string().regex(/^[0-9a-f]{7,64}$/)
  ]).parse(getRouterParam(event, 'commit'))
  try {
    return { version: await getCmsArticleVersion(id, commit) }
  } catch (error) {
    throwCmsWorkflowError(error)
  }
})
