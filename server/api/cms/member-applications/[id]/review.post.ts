import { createError, getRouterParam, readValidatedBody } from 'h3'
import { z } from 'zod'
import { reviewMemberApplication } from '../../../../services/member-applications'
import { memberApplicationReviewError } from '../../../../utils/member-application-review-error'
import { requireCmsCsrf, requireCmsRequestAuth } from '../../../../utils/cms-http'

const schema = z.object({ action: z.enum(['approve', 'reject']), note: z.string().trim().max(1000).default('') }).strict()
export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event, 'admin'); requireCmsCsrf(event, auth)
  const input = await readValidatedBody(event, schema.parse)
  try {
    return await reviewMemberApplication(z.string().uuid().parse(getRouterParam(event, 'id')), input.action, input.note, auth.user.id)
  } catch (error) {
    const failure = memberApplicationReviewError(error)
    if (failure) throw createError(failure)
    throw error
  }
})
