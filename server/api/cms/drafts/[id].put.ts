import { createError, getRouterParam, readValidatedBody } from 'h3'
import { z } from 'zod'
import {
  CmsDraftConflictError,
  CmsDraftNotFoundError,
  saveCmsDraft
} from '../../../services/cms-drafts'
import { cmsDraftSaveSchema } from '../../../utils/cms-draft-validation'
import {
  requireCmsCsrf,
  requireCmsRequestAuth
} from '../../../utils/cms-http'

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event)
  requireCmsCsrf(event, auth)
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const input = await readValidatedBody(event, cmsDraftSaveSchema.parse)

  try {
    return { draft: await saveCmsDraft(id, auth.user.id, input) }
  } catch (error) {
    if (error instanceof CmsDraftConflictError) {
      throw createError({
        statusCode: 409,
        message: '草稿已在其他页面更新，请刷新后继续'
      })
    }
    if (error instanceof CmsDraftNotFoundError) {
      throw createError({ statusCode: 404, message: '草稿不存在' })
    }
    if (error instanceof Error && error.message.startsWith('UNKNOWN_DRAFT_AUTHORS:')) {
      throw createError({ statusCode: 400, message: '作者成员 ID 不存在' })
    }
    throw error
  }
})
