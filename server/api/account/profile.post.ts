import { readValidatedBody } from 'h3'
import { z } from 'zod'
import { submitOwnMemberProfile } from '../../services/member-self-profile'
import { requireCmsCsrf, requireSiteRequestAuth } from '../../utils/cms-http'
import { throwMemberProfileError } from '../../utils/member-profile-http'

const schema = z.object({
  isLearner: z.boolean(), name: z.string().trim().min(1).max(100),
  avatarUrl: z.string().trim().min(1).max(2048), grade: z.string().trim().max(32),
  groupName: z.string().trim().max(64), affiliation: z.string().trim().max(200),
  positions: z.array(z.enum(['队长', '副队长', '组长', '机电创新学会会长', '指导老师', '成员', '顾问'])).max(7),
  seasons: z.array(z.string().trim().min(1).max(16)).max(100),
  advisorSeasons: z.array(z.string().trim().min(1).max(16)).max(100),
  body: z.string().max(10000),
  links: z.object({ github: z.string().trim().max(2048), 'home-page': z.string().trim().max(2048) }).strict(),
  expectedVersion: z.number().int().positive()
}).strict()

export default defineEventHandler(async event => {
  const auth = await requireSiteRequestAuth(event)
  requireCmsCsrf(event, auth)
  const input = await readValidatedBody(event, schema.parse)
  try { return { proposal: await submitOwnMemberProfile(auth.user, input) } }
  catch (error) { throwMemberProfileError(error) }
})
