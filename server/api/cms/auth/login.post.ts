import { createError, getHeader, readValidatedBody } from 'h3'
import { z } from 'zod'
import { authenticateCmsUser, createCmsSession } from '../../../services/cms-auth'
import { getCmsServerConfig } from '../../../utils/cms-config'
import {
  getCmsRequestIp,
  requireSameOrigin,
  setCmsSessionCookie
} from '../../../utils/cms-http'
import { createCsrfToken, hashClientIp } from '../../../utils/cms-security'

const loginSchema = z.object({
  email: z.email().max(320),
  password: z.string().min(1).max(1024)
})

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const input = await readValidatedBody(event, loginSchema.parse)
  const user = await authenticateCmsUser(input.email, input.password)

  if (!user) {
    throw createError({ statusCode: 401, message: '邮箱或密码错误' })
  }

  const config = getCmsServerConfig()
  const { token, expiresAt } = await createCmsSession(
    user,
    config.CMS_SESSION_TTL_HOURS,
    hashClientIp(getCmsRequestIp(event)),
    getHeader(event, 'user-agent')
  )
  setCmsSessionCookie(event, token, expiresAt)

  return {
    user,
    csrfToken: createCsrfToken(token)
  }
})
