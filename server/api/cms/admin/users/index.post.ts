import { createError, readValidatedBody } from 'h3'
import { z } from 'zod'
import {
  cmsAccountPattern,
  cmsPasswordMinLength,
  cmsRoleCodes
} from '../../../../../shared/types/cms-auth'
import { createCmsUser } from '../../../../services/cms-auth'
import { AccountRegistrationPendingError } from '../../../../services/account-registrations'
import {
  requireCmsCsrf,
  requireCmsRequestAuth
} from '../../../../utils/cms-http'

const createUserSchema = z.object({
  account: z.string().trim().toLowerCase().regex(cmsAccountPattern),
  password: z.string().min(cmsPasswordMinLength).max(1024),
  roles: z.array(z.enum(cmsRoleCodes)).length(1).default(['member'])
}).strict()

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event, 'admin')
  requireCmsCsrf(event, auth)
  const input = await readValidatedBody(event, createUserSchema.parse)

  try {
    const user = await createCmsUser(input, auth.user.id)
    return { user }
  } catch (error) {
    if (error instanceof AccountRegistrationPendingError) {
      throw createError({ statusCode: 409, message: '该账号 ID 已被待审核的注册申请占用' })
    }
    if (
      typeof error === 'object'
      && error !== null
      && 'code' in error
      && error.code === '23505'
    ) {
      throw createError({ statusCode: 409, message: '该账号已存在' })
    }

    throw error
  }
})
