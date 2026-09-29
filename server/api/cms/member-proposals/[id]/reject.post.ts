import { createError, getRouterParam, readValidatedBody } from 'h3'
import { z } from 'zod'
import { rejectMemberProposal } from '../../../../services/cms-members'
import { requireCmsCsrf, requireCmsRequestAuth } from '../../../../utils/cms-http'

const schema = z.object({ note: z.string().trim().max(1000).default('') }).strict()

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event, 'admin')
  requireCmsCsrf(event, auth)
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const input = await readValidatedBody(event, schema.parse)
  try {
    return { proposal: await rejectMemberProposal(id, input.note, auth.user.id) }
  } catch (error) {
    if (error instanceof Error && error.message === 'MEMBER_PROPOSAL_NOT_PENDING') {
      throw createError({ statusCode: 409, message: '提案已被处理，请刷新后重试' })
    }
    if (error instanceof Error && error.message === 'MEMBER_PROPOSAL_NOT_FOUND') {
      throw createError({ statusCode: 404, message: '成员提案不存在' })
    }
    throw error
  }
})
