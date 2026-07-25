import { createError, getRouterParam } from 'h3'
import { z } from 'zod'
import {
  CmsDraftNotFoundError,
  deleteCmsDraft
} from '../../../../services/cms-drafts'
import { requireCmsCsrf, requireCmsRequestAuth } from '../../../../utils/cms-http'

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event)
  requireCmsCsrf(event, auth)
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  try {
    return {
      draft: await deleteCmsDraft(id, auth.user.id, auth.user.roles.includes('admin'))
    }
  } catch (error) {
    if (error instanceof CmsDraftNotFoundError) {
      throw createError({ statusCode: 404, message: '草稿不存在或无权删除' })
    }
    throw error
  }
})
