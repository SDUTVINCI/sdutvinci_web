import { listCmsMembers } from '../../../services/cms-members'
import { requireCmsRequestAuth } from '../../../utils/cms-http'

export default defineEventHandler(async (event) => {
  await requireCmsRequestAuth(event)
  return { members: await listCmsMembers() }
})
