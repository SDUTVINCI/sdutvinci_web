import { createError, getRouterParam, readValidatedBody } from 'h3'
import { z } from 'zod'
import {
  AccountRegistrationAlreadyRegisteredError,
  AccountRegistrationAccountUnavailableError,
  AccountRegistrationStateError,
  reviewAccountRegistration
} from '../../../../services/account-registrations'
import { requireCmsCsrf, requireCmsRequestAuth } from '../../../../utils/cms-http'

const schema = z.object({
  action: z.enum(['approve', 'reject']),
  note: z.string().trim().max(1000).default('')
}).strict()

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event, 'admin')
  requireCmsCsrf(event, auth)
  const input = await readValidatedBody(event, schema.parse)
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  try {
    return await reviewAccountRegistration(id, input.action, input.note, auth.user.id)
  } catch (error) {
    if (error instanceof AccountRegistrationAlreadyRegisteredError) {
      throw createError({ statusCode: 409, message: '该成员已经绑定其他账号，请刷新申请列表。' })
    }
    if (error instanceof AccountRegistrationStateError) {
      throw createError({ statusCode: 409, message: '该注册申请已被处理，请刷新申请列表。' })
    }
    if (error instanceof AccountRegistrationAccountUnavailableError) {
      throw createError({ statusCode: 409, message: '账号 ID 与档案稳定 ID 不一致或已被占用，请先在成员管理中处理。' })
    }
    throw error
  }
})
