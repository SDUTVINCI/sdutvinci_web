import { createError, getRouterParam, readValidatedBody } from 'h3'
import { z } from 'zod'
import { executeContentPrExternalAction } from '../../../../services/content-pr-import'
import { requireCmsCsrf } from '../../../../utils/cms-http'
import { requireContentImportAuth, throwContentImportHttpError } from '../../../../utils/content-import-http'

const schema = z.object({ confirm: z.literal('CLOSE_PULL_REQUEST') }).strict()
export default defineEventHandler(async (event) => {
  const auth = await requireContentImportAuth(event)
  if (!auth.user.roles.includes('admin')) {
    throw createError({ statusCode: 403, message: '只有管理员可以关闭 PR' })
  }
  requireCmsCsrf(event, auth)
  await readValidatedBody(event, schema.parse)
  try {
    return await executeContentPrExternalAction(getRouterParam(event, 'id') || '', auth.user.id, 'close')
  } catch (error) { throwContentImportHttpError(error) }
})
