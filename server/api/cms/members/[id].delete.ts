import { createError, getRouterParam, readValidatedBody } from 'h3'
import { z } from 'zod'
import { CmsMemberVersionConflictError, deleteCmsMember } from '../../../services/cms-members'
import { requireCmsCsrf, requireCmsRequestAuth } from '../../../utils/cms-http'

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event, 'admin')
  requireCmsCsrf(event, auth)
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const input = await readValidatedBody(event, z.object({
    expectedVersion: z.number().int().positive(),
    confirmation: z.literal('DELETE_MEMBER')
  }).parse)
  try {
    return { member: await deleteCmsMember(id, input.expectedVersion, auth.user.id) }
  } catch (error) {
    if (error instanceof CmsMemberVersionConflictError) {
      throw createError({ statusCode: 409, message: error.message })
    }
    if (error instanceof Error && error.message === 'MEMBER_NOT_FOUND') {
      throw createError({ statusCode: 404, message: '成员不存在或已删除' })
    }
    throw error
  }
})
