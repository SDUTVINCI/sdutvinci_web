import { readValidatedBody } from 'h3'
import { z } from 'zod'
import { saveMemberCohort } from '../../services/member-options'
import { requireCmsCsrf, requireCmsRequestAuth } from '../../utils/cms-http'

const schema = z.object({
  gradeYear: z.number().int().min(2000).max(2200),
  season: z.string().trim().min(1).max(16),
  groups: z.array(z.string().trim().min(1).max(64)).min(1).max(20),
  active: z.boolean().optional()
}).strict()

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event, 'admin')
  requireCmsCsrf(event, auth)
  return { cohort: await saveMemberCohort(await readValidatedBody(event, schema.parse)) }
})
