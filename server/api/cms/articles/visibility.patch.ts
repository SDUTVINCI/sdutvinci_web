import { createError, readValidatedBody } from 'h3'
import { z } from 'zod'
import { CMS_ARTICLE_VISIBILITY_MAX_ITEMS } from '../../../../shared/types/cms-articles'
import {
  CmsArticleVisibilityStateError,
  updateCmsArticleVisibility
} from '../../../services/cms-articles'
import { requireCmsCsrf, requireCmsRequestAuth } from '../../../utils/cms-http'

const schema = z.object({
  articleIds: z.array(z.string().uuid())
    .min(1)
    .max(CMS_ARTICLE_VISIBILITY_MAX_ITEMS),
  requiresAuth: z.boolean()
}).strict()

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event, 'admin')
  requireCmsCsrf(event, auth)
  const input = await readValidatedBody(event, schema.parse)

  try {
    return {
      result: await updateCmsArticleVisibility(
        input.articleIds,
        input.requiresAuth,
        auth.user.id
      )
    }
  } catch (error) {
    if (error instanceof CmsArticleVisibilityStateError) {
      throw createError({ statusCode: 409, message: error.message })
    }
    throw error
  }
})
