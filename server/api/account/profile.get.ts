import { setResponseHeader } from 'h3'
import { getOwnMemberProfile, listOwnMemberProposals } from '../../services/member-self-profile'
import { requireSiteRequestAuth } from '../../utils/cms-http'

export default defineEventHandler(async event => {
  const { user } = await requireSiteRequestAuth(event)
  setResponseHeader(event, 'cache-control', 'private, no-store')
  if (!user.memberId) return { user, member: null, proposals: [] }
  const [member, proposals] = await Promise.all([getOwnMemberProfile(user), listOwnMemberProposals(user)])
  return { user, member, proposals }
})
