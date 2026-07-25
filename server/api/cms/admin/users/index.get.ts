import { listCmsUsers } from '../../../../services/cms-auth'
import { requireCmsRequestAuth } from '../../../../utils/cms-http'

export default defineEventHandler(async (event) => {
  await requireCmsRequestAuth(event, 'admin')
  return { users: await listCmsUsers() }
})
