import { createError, getRouterParam, readValidatedBody } from 'h3'
import { z } from 'zod'
import { executeContentPrExternalAction } from '../../../../services/content-pr-import'
import { requireCmsCsrf } from '../../../../utils/cms-http'
import { requireContentImportAuth, throwContentImportHttpError } from '../../../../utils/content-import-http'

const schema = z.object({
  confirm: z.literal('DELETE_PULL_REQUEST_BRANCH'),
  branch: z.string().trim().min(1).max(255)
}).strict()

export default defineEventHandler(async (event) => {
  const auth = await requireContentImportAuth(event)
  if (!auth.user.roles.includes('admin')) {
    throw createError({ statusCode: 403, message: '只有管理员可以删除 PR 源分支' })
  }
  requireCmsCsrf(event, auth)
  const input = await readValidatedBody(event, schema.parse)
  try {
    return await executeContentPrExternalAction(
      getRouterParam(event, 'id') || '',
      auth.user.id,
      'delete_branch',
      undefined,
      { confirmedBranch: input.branch }
    )
  } catch (error) {
    throwContentImportHttpError(error)
  }
})
