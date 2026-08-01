import { getRouterParam } from 'h3'
import { z } from 'zod'
import { listMemberProposals } from '../../../../services/cms-members'
import { requireCmsRequestAuth } from '../../../../utils/cms-http'

export default defineEventHandler(async (event) => {
  await requireCmsRequestAuth(event)
  const memberId = z.string().uuid().parse(getRouterParam(event, 'id'))
  return { proposals: await listMemberProposals(memberId) }
})
