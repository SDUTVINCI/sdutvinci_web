import {
  clearCmsSessionCookie,
  getCmsRequestIp,
  requireCmsCsrf,
  requireSiteRequestAuth
} from '../../../utils/cms-http'
import { revokeCmsSession } from '../../../services/cms-auth'
import { hashClientIp } from '../../../utils/cms-security'

export default defineEventHandler(async (event) => {
  const auth = await requireSiteRequestAuth(event)
  requireCmsCsrf(event, auth)
  await revokeCmsSession(
    auth.token,
    auth.user.id,
    hashClientIp(getCmsRequestIp(event))
  )
  clearCmsSessionCookie(event)

  return { ok: true }
})
