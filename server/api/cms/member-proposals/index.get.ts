import { listPendingMemberProfileProposals } from '../../../services/member-self-profile'
import { requireCmsRequestAuth } from '../../../utils/cms-http'
export default defineEventHandler(async event => {
  await requireCmsRequestAuth(event, 'admin')
  return { items: await listPendingMemberProfileProposals() }
})
