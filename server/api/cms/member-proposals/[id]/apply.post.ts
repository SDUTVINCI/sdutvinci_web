import { createError, getRouterParam, readValidatedBody } from 'h3'
import { z } from 'zod'
import { applyMemberProposal, CmsMemberVersionConflictError } from '../../../../services/cms-members'
import { requireCmsCsrf, requireCmsRequestAuth } from '../../../../utils/cms-http'

const schema = z.object({
  expectedVersion: z.number().int().positive(),
  confirmation: z.literal('APPLY_MEMBER_PROPOSAL')
}).strict()

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event, 'admin')
  requireCmsCsrf(event, auth)
  const proposalId = z.string().uuid().parse(getRouterParam(event, 'id'))
  const input = await readValidatedBody(event, schema.parse)
  try {
    return await applyMemberProposal(proposalId, input.expectedVersion, input.confirmation, auth.user.id)
  } catch (error) {
    if (error instanceof CmsMemberVersionConflictError) {
      throw createError({ statusCode: 409, message: error.message })
    }
    throw error
  }
})
