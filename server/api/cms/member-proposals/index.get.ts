import { listPendingMemberProposalsForReview } from '../../../services/cms-members'
import { requireCmsRequestAuth } from '../../../utils/cms-http'

export default defineEventHandler(async (event) => {
  await requireCmsRequestAuth(event, 'admin')
  return { proposals: await listPendingMemberProposalsForReview() }
})
