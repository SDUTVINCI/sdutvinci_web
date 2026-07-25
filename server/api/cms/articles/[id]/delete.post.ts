import { createError, getRouterParam } from 'h3'
import { z } from 'zod'
import {
  CmsArticleDeletionGitError,
  CmsArticleDeletionNotFoundError,
  CmsArticleDeletionStateError,
  deleteCmsArticle
} from '../../../../services/cms-deletions'
import { requireCmsCsrf, requireCmsRequestAuth } from '../../../../utils/cms-http'

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event, 'admin')
  requireCmsCsrf(event, auth)
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  try {
    return { result: await deleteCmsArticle(id, auth.user.id) }
  } catch (error) {
    if (error instanceof CmsArticleDeletionNotFoundError) {
      throw createError({ statusCode: 404, message: '正式文章不存在或已经删除' })
    }
    if (error instanceof CmsArticleDeletionStateError) {
      throw createError({ statusCode: 409, message: error.message })
    }
    if (error instanceof CmsArticleDeletionGitError) {
      throw createError({ statusCode: 502, message: `删除未完成：${error.message}` })
    }
    throw error
  }
})
