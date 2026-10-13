import {
  getCmsCsrfToken,
  requireSiteRequestAuth
} from '../../../utils/cms-http'

export default defineEventHandler(async (event) => {
  const auth = await requireSiteRequestAuth(event)

  return {
    user: auth.user,
    csrfToken: getCmsCsrfToken(auth)
  }
})
