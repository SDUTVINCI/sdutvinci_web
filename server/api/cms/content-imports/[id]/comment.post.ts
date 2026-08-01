import { getRouterParam, readValidatedBody } from 'h3'
import { z } from 'zod'
import { executeContentPrExternalAction } from '../../../../services/content-pr-import'
import { requireCmsCsrf } from '../../../../utils/cms-http'
import { requireContentImportAuth, throwContentImportHttpError } from '../../../../utils/content-import-http'

const schema = z.object({ confirm: z.literal('COMMENT_IMPORT_RESULT') }).strict()
export default defineEventHandler(async (event) => {
  const auth = await requireContentImportAuth(event)
  requireCmsCsrf(event, auth)
  await readValidatedBody(event, schema.parse)
  try {
    return await executeContentPrExternalAction(getRouterParam(event, 'id') || '', auth.user.id, 'comment')
  } catch (error) { throwContentImportHttpError(error) }
})
