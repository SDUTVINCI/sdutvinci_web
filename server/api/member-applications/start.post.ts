import { getCmsRequestIp, throwCmsRateLimitError } from '../../utils/cms-http'
import { CmsRateLimitError, consumePublicMemberApplicationLimit } from '../../services/cms-rate-limits'
import { startMemberApplication } from '../../services/member-applications'

export default defineEventHandler(async (event) => {
  try { await consumePublicMemberApplicationLimit(getCmsRequestIp(event) || 'unknown') }
  catch (error) { if (error instanceof CmsRateLimitError) throwCmsRateLimitError(event, error); throw error }
  return startMemberApplication()
})
