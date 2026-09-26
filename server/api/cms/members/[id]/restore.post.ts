import { createError, getRouterParam, readValidatedBody } from 'h3'
import { z } from 'zod'
import { CmsMemberKeyConflictError, CmsMemberVersionConflictError, restoreCmsMemberRevision } from '../../../../services/cms-members'
import { requireCmsCsrf, requireCmsRequestAuth } from '../../../../utils/cms-http'

const schema = z.object({
  revisionId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  confirmation: z.literal('RESTORE_MEMBER_REVISION')
}).strict()

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event, 'admin')
  requireCmsCsrf(event, auth)
  const memberId = z.string().uuid().parse(getRouterParam(event, 'id'))
  const input = await readValidatedBody(event, schema.parse)
  try {
    return { member: await restoreCmsMemberRevision(memberId, input.revisionId, input.expectedVersion, auth.user.id) }
  } catch (error) {
    if (error instanceof CmsMemberVersionConflictError) {
      throw createError({ statusCode: 409, message: error.message })
    }
    if (error instanceof CmsMemberKeyConflictError || (typeof error === 'object' && error && 'code' in error && error.code === '23505')) {
      throw createError({ statusCode: 409, message: error instanceof Error ? error.message : '该成员 ID 或文件路径已被占用' })
    }
    throw error
  }
})
