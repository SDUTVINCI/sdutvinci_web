import { getRouterParam } from 'h3'
import { z } from 'zod'
import { getCmsReviewDetail } from '../../../services/cms-reviews'
import { requireCmsRequestAuth } from '../../../utils/cms-http'
import { throwCmsWorkflowError } from '../../../utils/cms-workflow-http'

export default defineEventHandler(async (event) => {
  await requireCmsRequestAuth(event, 'admin')
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  try {
    return { review: await getCmsReviewDetail(id) }
  } catch (error) {
    throwCmsWorkflowError(error)
  }
})
