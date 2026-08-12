import { createError, getValidatedQuery } from 'h3'
import { z } from 'zod'
import { cmsDraftStatuses } from '../../../../shared/types/cms-drafts'
import { listCmsDrafts } from '../../../services/cms-drafts'
import { requireCmsRequestAuth } from '../../../utils/cms-http'

const schema = z.object({
  status: z.enum(cmsDraftStatuses).optional(),
  view: z.enum(['active']).optional(),
  deleted: z.enum(['true', 'false']).transform(value => value === 'true').optional(),
  scope: z.enum(['mine', 'all']).optional()
}).refine(input => !(input.view === 'active' && input.status === 'published'), {
  message: '活动草稿视图不能筛选已发布历史'
})

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event)
  const query = await getValidatedQuery(event, schema.parse)
  const allowAll = query.scope === 'all'
  if (allowAll && !auth.user.roles.includes('admin')) {
    throw createError({ statusCode: 403, message: '只有管理员可以查看全部草稿' })
  }
  return {
    drafts: await listCmsDrafts(auth.user.id, {
      status: query.status,
      active: query.view === 'active',
      deleted: query.deleted
    }, allowAll)
  }
})
