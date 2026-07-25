import { getCmsDashboardStats } from '../../services/cms-dashboard'
import { requireCmsRequestAuth } from '../../utils/cms-http'

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event)
  return {
    stats: await getCmsDashboardStats(
      auth.user.id,
      auth.user.roles.includes('admin')
    )
  }
})
