import { readValidatedBody, setResponseHeader } from 'h3'
import { z } from 'zod'
import { CMS_MEMBER_REVIEW_CONFIRMATION, CMS_MEMBER_REVIEW_MAX_ITEMS } from '../../../../shared/types/cms-member-review'
import { batchReviewMemberRequests } from '../../../services/cms-member-batch-review'
import { requireCmsCsrf, requireCmsRequestAuth } from '../../../utils/cms-http'

const schema = z.object({
  kind: z.enum(['application', 'proposal', 'registration']), action: z.enum(['approve', 'reject']),
  items: z.array(z.object({ id: z.string().uuid(), version: z.number().int().positive().optional() }).strict())
    .min(1).max(CMS_MEMBER_REVIEW_MAX_ITEMS).refine(items => new Set(items.map(item => item.id)).size === items.length, '申请不能重复'),
  note: z.string().trim().max(1000).default(''), confirm: z.literal(CMS_MEMBER_REVIEW_CONFIRMATION)
}).strict().superRefine((input, ctx) => {
  if (input.action === 'reject' && !input.note) ctx.addIssue({ code: 'custom', message: '拒绝前请填写审核原因', path: ['note'] })
  if (input.kind === 'proposal' && input.action === 'approve' && input.items.some(item => !item.version)) ctx.addIssue({ code: 'custom', message: '缺少成员版本', path: ['items'] })
})

export default defineEventHandler(async event => {
  const auth = await requireCmsRequestAuth(event, 'admin')
  requireCmsCsrf(event, auth)
  setResponseHeader(event, 'cache-control', 'private, no-store')
  const input = await readValidatedBody(event, schema.parse)
  return { results: await batchReviewMemberRequests(input.kind, input.action, input.items, input.note, auth.user.id) }
})
