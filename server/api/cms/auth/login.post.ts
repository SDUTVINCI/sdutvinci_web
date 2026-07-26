import { createError, getHeader, readValidatedBody } from 'h3'
import { z } from 'zod'
import { cmsAccountPattern } from '../../../../shared/types/cms-auth'
import { authenticateCmsUser, createCmsSession } from '../../../services/cms-auth'
import {
  assertCmsLoginAllowed,
  clearCmsLoginFailures,
  CmsRateLimitError,
  maybePruneCmsRateLimitBuckets,
  recordCmsLoginFailure
} from '../../../services/cms-rate-limits'
import { getCmsServerConfig } from '../../../utils/cms-config'
import {
  getCmsRequestIp,
  requireSameOrigin,
  setCmsSessionCookie,
  throwCmsRateLimitError
} from '../../../utils/cms-http'
import {
  createCsrfToken,
  hashClientIp,
  hashCmsSecurityKey
} from '../../../utils/cms-security'

const loginSchema = z.object({
  account: z.string().trim().toLowerCase().regex(cmsAccountPattern),
  password: z.string().min(1).max(1024)
}).strict()

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const input = await readValidatedBody(event, loginSchema.parse)
  const ipHash = hashClientIp(getCmsRequestIp(event))
    || hashCmsSecurityKey('ip', 'unavailable')

  await maybePruneCmsRateLimitBuckets()
  try {
    await assertCmsLoginAllowed(input.account, ipHash)
  } catch (error) {
    if (error instanceof CmsRateLimitError) {
      throwCmsRateLimitError(event, error, '登录尝试过于频繁，请稍后重试')
    }
    throw error
  }

  const user = await authenticateCmsUser(input.account, input.password)

  if (!user) {
    try {
      await recordCmsLoginFailure(input.account)
    } catch (error) {
      if (error instanceof CmsRateLimitError) {
        throwCmsRateLimitError(event, error, '登录尝试过于频繁，请稍后重试')
      }
      throw error
    }
    throw createError({ statusCode: 401, message: '账号或密码错误' })
  }

  await clearCmsLoginFailures(input.account)
  const config = getCmsServerConfig()
  const { token, expiresAt } = await createCmsSession(
    user,
    config.CMS_SESSION_TTL_HOURS,
    ipHash,
    getHeader(event, 'user-agent')
  )
  setCmsSessionCookie(event, token, expiresAt)

  return {
    user,
    csrfToken: createCsrfToken(token)
  }
})
