import {
  getCmsCsrfToken,
  requireCmsRequestAuth
} from '../../../utils/cms-http'

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event)

  return {
    user: auth.user,
    csrfToken: getCmsCsrfToken(auth)
  }
})
