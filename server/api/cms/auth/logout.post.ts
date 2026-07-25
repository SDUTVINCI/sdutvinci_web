import {
  clearCmsSessionCookie,
  getCmsRequestIp,
  requireCmsCsrf,
  requireCmsRequestAuth
} from '../../../utils/cms-http'
import { revokeCmsSession } from '../../../services/cms-auth'
import { hashClientIp } from '../../../utils/cms-security'

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event)
  requireCmsCsrf(event, auth)
  await revokeCmsSession(
    auth.token,
    auth.user.id,
    hashClientIp(getCmsRequestIp(event))
  )
  clearCmsSessionCookie(event)

  return { ok: true }
})
