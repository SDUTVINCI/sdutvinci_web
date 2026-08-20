import { createError, getRouterParam, readValidatedBody } from 'h3'
import { z } from 'zod'
import {
  saveCmsDraft
} from '../../../services/cms-drafts'
import { cmsDraftSaveSchema } from '../../../utils/cms-draft-validation'
import {
  requireCmsCsrf,
  requireCmsRequestAuth
} from '../../../utils/cms-http'
import { throwCmsWorkflowError } from '../../../utils/cms-workflow-http'

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event)
  requireCmsCsrf(event, auth)
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const input = await readValidatedBody(event, cmsDraftSaveSchema.parse)

  try {
    return {
      draft: await saveCmsDraft(
        id,
        auth.user.id,
        input,
        auth.user.roles.includes('admin')
      )
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('UNKNOWN_DRAFT_AUTHORS:')) {
      throw createError({ statusCode: 400, message: '作者成员 ID 不存在' })
    }
    if (error instanceof Error && [
      'WIKI_TAGS_INVALID',
      'WIKI_TAGS_ONLY_DOCUMENT_INDEX'
    ].includes(error.message)) {
      throw createError({ statusCode: 400, message: '只有 Wiki 主文档可以设置固定组别标签' })
    }
    throwCmsWorkflowError(error)
  }
})
