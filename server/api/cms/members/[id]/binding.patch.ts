import { createError, getRouterParam, readValidatedBody } from 'h3'
import { z } from 'zod'
import { bindCmsMemberAccount, CmsMemberBindingConflictError } from '../../../../services/cms-members'
import { requireCmsCsrf, requireCmsRequestAuth } from '../../../../utils/cms-http'

const schema = z.object({ userId: z.string().uuid().nullable() }).strict()

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event, 'admin')
  requireCmsCsrf(event, auth)
  const memberId = z.string().uuid().parse(getRouterParam(event, 'id'))
  const input = await readValidatedBody(event, schema.parse)
  try {
    return { member: await bindCmsMemberAccount(memberId, input.userId, auth.user.id) }
  } catch (error) {
    if (error instanceof CmsMemberBindingConflictError) {
      throw createError({ statusCode: 409, message: error.message })
    }
    throw error
  }
})
