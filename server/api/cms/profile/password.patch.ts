import { createError, readValidatedBody } from 'h3'
import { z } from 'zod'
import { cmsPasswordMinLength } from '../../../../shared/types/cms-auth'
import { changeCmsOwnPassword } from '../../../services/cms-auth'
import {
  requireCmsCsrf,
  requireCmsRequestAuth
} from '../../../utils/cms-http'

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().min(cmsPasswordMinLength).max(1024)
}).strict().refine(
  value => value.currentPassword !== value.newPassword,
  {
    message: '新密码不能与当前密码相同',
    path: ['newPassword']
  }
)

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event)
  requireCmsCsrf(event, auth)
  const input = await readValidatedBody(event, changePasswordSchema.parse)
  const changed = await changeCmsOwnPassword(
    auth.user.id,
    input.currentPassword,
    input.newPassword,
    auth.token
  )

  if (!changed) {
    throw createError({
      statusCode: 400,
      message: '当前密码错误或账号已发生变化，请重试'
    })
  }

  return { changed: true }
})
