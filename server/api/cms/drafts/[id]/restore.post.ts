import { createError, getRouterParam } from 'h3'
import { z } from 'zod'
import {
  CmsDraftDeleteConflictError,
  CmsDraftNotFoundError,
  restoreCmsDraft
} from '../../../../services/cms-drafts'
import { requireCmsCsrf, requireCmsRequestAuth } from '../../../../utils/cms-http'

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event)
  requireCmsCsrf(event, auth)
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  try {
    return {
      draft: await restoreCmsDraft(id, auth.user.id, auth.user.roles.includes('admin'))
    }
  } catch (error) {
    if (error instanceof CmsDraftNotFoundError) {
      throw createError({ statusCode: 404, message: '已删除草稿不存在或无权恢复' })
    }
    if (error instanceof CmsDraftDeleteConflictError) {
      throw createError({ statusCode: 409, message: error.message })
    }
    throw error
  }
})
