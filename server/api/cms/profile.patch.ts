import { createError, readValidatedBody } from 'h3'
import { z } from 'zod'
import { updateCmsUser } from '../../services/cms-auth'
import {
  requireCmsCsrf,
  requireCmsRequestAuth
} from '../../utils/cms-http'

const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(100)
})

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event)
  requireCmsCsrf(event, auth)
  const input = await readValidatedBody(event, profileSchema.parse)
  const user = await updateCmsUser(
    auth.user.id,
    { displayName: input.displayName },
    auth.user.id
  )

  if (!user) {
    throw createError({ statusCode: 404, message: '用户不存在' })
  }

  return { user }
})
