import { getCmsOrganization } from '../../services/organization'
import { requireCmsRequestAuth } from '../../utils/cms-http'

export default defineEventHandler(async (event) => {
  await requireCmsRequestAuth(event, 'admin')
  return getCmsOrganization()
})
