import { createError, getRouterParam } from 'h3'
import { z } from 'zod'
import { getCmsDraft } from '../../../../services/cms-drafts'
import { getCmsDraftComparison } from '../../../../services/cms-reviews'
import { requireCmsRequestAuth } from '../../../../utils/cms-http'
import { throwCmsWorkflowError } from '../../../../utils/cms-workflow-http'

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event)
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const draft = await getCmsDraft(
    id,
    auth.user.id,
    auth.user.roles.includes('admin')
  )
  if (!draft) throw createError({ statusCode: 404, message: '草稿不存在' })
  try {
    return { comparison: await getCmsDraftComparison(id) }
  } catch (error) {
    throwCmsWorkflowError(error)
  }
})
