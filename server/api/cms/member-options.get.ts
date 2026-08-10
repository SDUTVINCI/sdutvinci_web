import { listMemberOptions } from '../../services/member-options'
import { requireCmsRequestAuth } from '../../utils/cms-http'

export default defineEventHandler(async (event) => {
  await requireCmsRequestAuth(event, 'admin')
  return listMemberOptions(true)
})
