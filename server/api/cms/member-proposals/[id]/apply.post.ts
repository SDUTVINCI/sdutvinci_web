import { createError, getRouterParam, readValidatedBody } from 'h3'
import { z } from 'zod'
import { applyMemberProposal, CmsMemberVersionConflictError, CmsMemberKeyConflictError } from '../../../../services/cms-members'
import { requireCmsCsrf, requireCmsRequestAuth } from '../../../../utils/cms-http'

const schema = z.object({
  expectedVersion: z.number().int().positive(),
  confirmation: z.literal('APPLY_MEMBER_PROPOSAL'),
  note: z.string().trim().max(2000).optional()
}).strict()

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event, 'admin')
  requireCmsCsrf(event, auth)
  const proposalId = z.string().uuid().parse(getRouterParam(event, 'id'))
  const input = await readValidatedBody(event, schema.parse)
  try {
    return await applyMemberProposal(proposalId, input.expectedVersion, input.confirmation, auth.user.id, input.note)
  } catch (error) {
    if (error instanceof CmsMemberVersionConflictError || error instanceof CmsMemberKeyConflictError) {
      throw createError({ statusCode: 409, message: error.message })
    }
    if (error instanceof Error && error.message === 'MEMBER_PROPOSAL_NOT_PENDING') {
      throw createError({ statusCode: 409, message: '提案已被处理，请刷新后重试' })
    }
    if (error instanceof Error && error.message === 'MEMBER_PROPOSAL_NOT_FOUND') {
      throw createError({ statusCode: 404, message: '成员提案不存在' })
    }
    if (error instanceof Error && ['MEMBER_GRADE_INVALID', 'MEMBER_GROUP_INVALID',
      'MEMBER_SEASON_INVALID', 'MEMBER_ADVISOR_SEASON_INVALID'].includes(error.message)) {
      throw createError({ statusCode: 400, message: '提案中包含当前不可选的年级、组别或赛季，请重新提交提案' })
    }
    throw error
  }
})
