import { getRouterParam } from 'h3'
import { z } from 'zod'
import { withdrawOwnMemberProposal } from '../../../../services/member-self-profile'
import { requireCmsCsrf, requireSiteRequestAuth } from '../../../../utils/cms-http'
import { throwMemberProfileError } from '../../../../utils/member-profile-http'
export default defineEventHandler(async event => {
  const auth = await requireSiteRequestAuth(event)
  requireCmsCsrf(event, auth)
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  try { await withdrawOwnMemberProposal(auth.user, id); return { withdrawn: true } }
  catch (error) { throwMemberProfileError(error) }
})
