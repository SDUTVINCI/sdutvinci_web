import { createError, getRouterParam, readValidatedBody } from 'h3'
import { z } from 'zod'
import { cmsRoleCodes } from '../../../../../shared/types/cms-auth'
import {
  countAdmins,
  getCmsUser,
  updateCmsUser
} from '../../../../services/cms-auth'
import {
  requireCmsCsrf,
  requireCmsRequestAuth
} from '../../../../utils/cms-http'

const updateUserSchema = z.object({
  displayName: z.string().trim().min(1).max(100).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  roles: z.array(z.enum(cmsRoleCodes)).min(1).optional()
}).refine(value => Object.keys(value).length > 0, '至少提交一个修改项')

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event, 'admin')
  requireCmsCsrf(event, auth)
  const userId = getRouterParam(event, 'id')

  if (!userId) {
    throw createError({ statusCode: 400, message: '缺少用户 ID' })
  }

  const current = await getCmsUser(userId)
  if (!current) {
    throw createError({ statusCode: 404, message: '用户不存在' })
  }

  const input = await readValidatedBody(event, updateUserSchema.parse)
  const removesAdmin = current.roles.includes('admin')
    && (
      input.status === 'disabled'
      || (input.roles !== undefined && !input.roles.includes('admin'))
    )

  if (removesAdmin && await countAdmins() <= 1) {
    throw createError({
      statusCode: 409,
      message: '不能停用或移除最后一个管理员'
    })
  }

  const user = await updateCmsUser(userId, input, auth.user.id)
  return { user }
})
