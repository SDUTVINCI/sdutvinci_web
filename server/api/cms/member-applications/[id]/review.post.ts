import { createError, getRouterParam, readValidatedBody } from 'h3'
import { z } from 'zod'
import { reviewMemberApplication } from '../../../../services/member-applications'
import { CmsMemberKeyConflictError } from '../../../../services/cms-members'
import { requireCmsCsrf, requireCmsRequestAuth } from '../../../../utils/cms-http'

const schema = z.object({ action: z.enum(['approve', 'reject']), note: z.string().trim().max(1000).default('') }).strict()
export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event, 'admin'); requireCmsCsrf(event, auth)
  const input = await readValidatedBody(event, schema.parse)
  try {
    return await reviewMemberApplication(z.string().uuid().parse(getRouterParam(event, 'id')), input.action, input.note, auth.user.id)
  } catch (error) {
    if (error instanceof CmsMemberKeyConflictError || (typeof error === 'object' && error && 'code' in error && error.code === '23505')) {
      throw createError({ statusCode: 409, message: '成员稳定 ID 已被使用，请刷新后重试' })
    }
    throw error
  }
})
