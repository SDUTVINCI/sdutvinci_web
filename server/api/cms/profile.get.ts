import { requireCmsRequestAuth } from '../../utils/cms-http'

export default defineEventHandler(async (event) => {
  const { user } = await requireCmsRequestAuth(event)
  return { user }
})
