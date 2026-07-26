import { createError, getRouterParam, readValidatedBody } from 'h3'
import { z } from 'zod'
import {
  cmsPasswordMinLength,
  cmsRoleCodes
} from '../../../../../shared/types/cms-auth'
import {
  CmsLastAdminError,
  getCmsUser,
  updateCmsUser
} from '../../../../services/cms-auth'
import {
  requireCmsCsrf,
  requireCmsRequestAuth
} from '../../../../utils/cms-http'

const updateUserSchema = z.object({
  status: z.enum(['active', 'disabled']).optional(),
  roles: z.array(z.enum(cmsRoleCodes)).min(1).optional(),
  password: z.string().min(cmsPasswordMinLength).max(1024).optional()
}).strict().refine(value => Object.keys(value).length > 0, '至少提交一个修改项')

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event, 'admin')
  requireCmsCsrf(event, auth)
  const userId = z.string().uuid().parse(getRouterParam(event, 'id'))

  const current = await getCmsUser(userId)
  if (!current) {
    throw createError({ statusCode: 404, message: '用户不存在' })
  }

  const input = await readValidatedBody(event, updateUserSchema.parse)
  if (input.password && current.id === auth.user.id) {
    throw createError({
      statusCode: 400,
      message: '请通过“修改我的密码”验证当前密码后再修改'
    })
  }
  try {
    const user = await updateCmsUser(userId, input, auth.user.id)
    return { user }
  } catch (error) {
    if (error instanceof CmsLastAdminError) {
      throw createError({
        statusCode: 409,
        message: error.message
      })
    }
    throw error
  }
})
