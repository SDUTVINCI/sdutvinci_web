import { readValidatedBody } from 'h3'
import { z } from 'zod'
import { dryRunContentPrImport } from '../../../services/content-pr-import'
import { requireCmsCsrf } from '../../../utils/cms-http'
import { requireContentImportAuth, throwContentImportHttpError } from '../../../utils/content-import-http'

const schema = z.object({
  repository: z.string().trim().min(1).max(300),
  pullRequestNumber: z.number().int().positive().max(10_000_000)
}).strict()

export default defineEventHandler(async (event) => {
  const auth = await requireContentImportAuth(event)
  requireCmsCsrf(event, auth)
  const input = await readValidatedBody(event, schema.parse)
  try {
    return { run: await dryRunContentPrImport(auth.user.id, input) }
  } catch (error) {
    throwContentImportHttpError(error)
  }
})
