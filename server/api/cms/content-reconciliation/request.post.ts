import { requestContentReconciliation } from '../../../services/content-reconciliation-requests'
import { requireCmsCsrf, requireCmsRequestAuth } from '../../../utils/cms-http'

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event, 'admin')
  requireCmsCsrf(event, auth)
  const request = await requestContentReconciliation(auth.user.id)
  setResponseStatus(event, request.created ? 202 : 200)
  return { request }
})
