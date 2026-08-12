import {
  listCmsApprovedReviews,
  listCmsPendingReviews
} from '../../../services/cms-reviews'
import { requireCmsRequestAuth } from '../../../utils/cms-http'

export default defineEventHandler(async (event) => {
  await requireCmsRequestAuth(event, 'admin')
  const [reviews, approved] = await Promise.all([
    listCmsPendingReviews(),
    listCmsApprovedReviews()
  ])
  return { reviews, approved }
})
