import { createError, getRouterParam, readValidatedBody } from 'h3'
import { z } from 'zod'
import {
  CmsCurrentUserDeletionError,
  CmsLastAdminError,
  deleteCmsUser
} from '../../../../services/cms-auth'
import { requireCmsCsrf, requireCmsRequestAuth } from '../../../../utils/cms-http'

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event, 'admin')
  requireCmsCsrf(event, auth)
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  await readValidatedBody(event, z.object({
    confirmation: z.literal('DELETE_USER')
  }).parse)
  try {
    return { result: await deleteCmsUser(id, auth.user.id) }
  } catch (error) {
    if (error instanceof CmsCurrentUserDeletionError || error instanceof CmsLastAdminError) {
      throw createError({ statusCode: 409, message: error.message })
    }
    if (error instanceof Error && error.message === 'CMS_USER_NOT_FOUND') {
      throw createError({ statusCode: 404, message: '账号不存在' })
    }
    throw error
  }
})
