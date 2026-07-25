import { listCmsPendingReviews } from '../../../services/cms-reviews'
import { requireCmsRequestAuth } from '../../../utils/cms-http'

export default defineEventHandler(async (event) => {
  await requireCmsRequestAuth(event, 'admin')
  return { reviews: await listCmsPendingReviews() }
})
