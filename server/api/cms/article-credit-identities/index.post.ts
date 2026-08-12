import { createError, readValidatedBody } from 'h3'
import { z } from 'zod'
import { cmsAccountPattern } from '../../../../shared/types/cms-auth'
import {
  ArticleCreditIdentityConflictError,
  createArticleCreditIdentity
} from '../../../services/article-credit-identities'
import { requireCmsCsrf, requireCmsRequestAuth } from '../../../utils/cms-http'

const schema = z.object({
  creditKey: z.string().trim().toLowerCase().regex(cmsAccountPattern).optional(),
  displayName: z.string().trim().min(1).max(100),
  memberId: z.string().uuid().nullable().optional()
}).strict()

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event, 'admin')
  requireCmsCsrf(event, auth)
  try {
    const identity = await createArticleCreditIdentity(
      await readValidatedBody(event, schema.parse),
      auth.user.id
    )
    return { identity }
  } catch (error) {
    if (error instanceof ArticleCreditIdentityConflictError
      || (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505')) {
      throw createError({
        statusCode: 409,
        message: error instanceof Error ? error.message : '该署名稳定 ID 已存在'
      })
    }
    throw error
  }
})
