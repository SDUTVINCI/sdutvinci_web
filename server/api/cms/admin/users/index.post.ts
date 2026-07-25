import { createError, readValidatedBody } from 'h3'
import { z } from 'zod'
import {
  cmsAccountPattern,
  cmsRoleCodes
} from '../../../../../shared/types/cms-auth'
import { createCmsUser } from '../../../../services/cms-auth'
import {
  requireCmsCsrf,
  requireCmsRequestAuth
} from '../../../../utils/cms-http'

const createUserSchema = z.object({
  account: z.string().trim().toLowerCase().regex(cmsAccountPattern),
  email: z.email().max(320),
  displayName: z.string().trim().min(1).max(100),
  password: z.string().min(12).max(1024),
  roles: z.array(z.enum(cmsRoleCodes)).min(1).default(['member'])
})

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event, 'admin')
  requireCmsCsrf(event, auth)
  const input = await readValidatedBody(event, createUserSchema.parse)

  try {
    const user = await createCmsUser(input, auth.user.id)
    return { user }
  } catch (error) {
    if (
      typeof error === 'object'
      && error !== null
      && 'code' in error
      && error.code === '23505'
    ) {
      throw createError({ statusCode: 409, message: '该账号或邮箱已存在' })
    }

    throw error
  }
})
