import { createError, readValidatedBody } from 'h3'
import { z } from 'zod'
import { cmsPasswordMinLength } from '../../../shared/types/cms-auth'
import {
  AccountRegistrationAlreadyRegisteredError,
  AccountRegistrationPendingError,
  submitAccountRegistration
} from '../../services/account-registrations'
import {
  CmsRateLimitError,
  consumePublicAccountRegistrationLimit,
  maybePruneCmsRateLimitBuckets
} from '../../services/cms-rate-limits'
import {
  getCmsRequestIp,
  requireSameOrigin,
  throwCmsRateLimitError
} from '../../utils/cms-http'
import { hashClientIp } from '../../utils/cms-security'

const schema = z.object({
  memberId: z.string().uuid(),
  password: z.string().min(cmsPasswordMinLength).max(1024)
}).strict()

export default defineEventHandler(async (event) => {
  requireSameOrigin(event)
  const input = await readValidatedBody(event, schema.parse)
  const requestIp = getCmsRequestIp(event) || 'unknown'
  await maybePruneCmsRateLimitBuckets()
  try {
    await consumePublicAccountRegistrationLimit(requestIp)
  } catch (error) {
    if (error instanceof CmsRateLimitError) {
      throwCmsRateLimitError(event, error, '注册申请过于频繁，请稍后重试')
    }
    throw error
  }

  try {
    return await submitAccountRegistration({
      ...input,
      ipHash: hashClientIp(requestIp)
    })
  } catch (error) {
    if (error instanceof AccountRegistrationAlreadyRegisteredError) {
      throw createError({
        statusCode: 409,
        message: '该成员已经注册账号；如需找回密码，请联系 Vinci 机器人队管理员。',
        data: { code: 'MEMBER_ALREADY_REGISTERED' }
      })
    }
    if (error instanceof AccountRegistrationPendingError) {
      throw createError({
        statusCode: 409,
        message: '该成员已有待审核的注册申请，请勿重复提交。',
        data: { code: 'REGISTRATION_ALREADY_PENDING' }
      })
    }
    if (error instanceof Error && error.message === 'ACCOUNT_REGISTRATION_MEMBER_NOT_FOUND') {
      throw createError({ statusCode: 404, message: '没有找到可注册的正式成员信息' })
    }
    throw error
  }
})
