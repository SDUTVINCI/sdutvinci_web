import { createError, getRouterParam, readValidatedBody } from 'h3'
import { z } from 'zod'
import { cmsAccountPattern } from '../../../../shared/types/cms-auth'
import {
  ArticleCreditIdentityConflictError,
  updateArticleCreditIdentity
} from '../../../services/article-credit-identities'
import { requireCmsCsrf, requireCmsRequestAuth } from '../../../utils/cms-http'

const schema = z.object({
  displayName: z.string().trim().min(1).max(100),
  memberId: z.string().uuid().nullable().optional(),
  expectedVersion: z.number().int().positive()
}).strict()

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event, 'admin')
  requireCmsCsrf(event, auth)
  const creditKey = z.string().regex(cmsAccountPattern).parse(getRouterParam(event, 'creditKey'))
  try {
    const identity = await updateArticleCreditIdentity(
      creditKey,
      await readValidatedBody(event, schema.parse),
      auth.user.id
    )
    if (!identity) throw createError({ statusCode: 404, message: '署名身份不存在' })
    return { identity }
  } catch (error) {
    if (error instanceof ArticleCreditIdentityConflictError) {
      throw createError({ statusCode: 409, message: error.message })
    }
    throw error
  }
})
