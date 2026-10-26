import { getValidatedQuery, setResponseHeader } from 'h3'
import { requireCmsRequestAuth } from '../../../../utils/cms-http'
import { reviewHistoryQuerySchema } from '../../../../utils/cms-review-history-query'
import { listReviewHistory } from '../../../../services/cms-review-history'

export default defineEventHandler(async event => {
  await requireCmsRequestAuth(event, 'admin')
  setResponseHeader(event, 'cache-control', 'private, no-store')
  return listReviewHistory(await getValidatedQuery(event, reviewHistoryQuerySchema.parse))
})
