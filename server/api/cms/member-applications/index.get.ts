import { listSubmittedMemberApplications } from '../../../services/member-applications'
import { requireCmsRequestAuth } from '../../../utils/cms-http'

export default defineEventHandler(async (event) => {
  await requireCmsRequestAuth(event, 'admin')
  return { applications: await listSubmittedMemberApplications() }
})
