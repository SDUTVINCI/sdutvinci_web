import { listCmsDrafts } from '../../../services/cms-drafts'
import { requireCmsRequestAuth } from '../../../utils/cms-http'

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event)
  return { drafts: await listCmsDrafts(auth.user.id) }
})
