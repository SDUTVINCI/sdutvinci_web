import { getRouterParam, readValidatedBody } from 'h3'
import { z } from 'zod'
import { rejectMemberProfileProposal } from '../../../../services/member-self-profile'
import { requireCmsCsrf, requireCmsRequestAuth } from '../../../../utils/cms-http'
import { throwMemberProfileError } from '../../../../utils/member-profile-http'
export default defineEventHandler(async event => {
  const auth = await requireCmsRequestAuth(event, 'admin')
  requireCmsCsrf(event, auth)
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const input = await readValidatedBody(event, z.object({ note: z.string().trim().min(1).max(2000) }).strict().parse)
  try { await rejectMemberProfileProposal(id, input.note, auth.user.id); return { rejected: true } }
  catch (error) { throwMemberProfileError(error) }
})
