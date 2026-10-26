import { z } from 'zod'
import { reviewHistoryActions, reviewHistoryKinds } from '../../shared/types/cms-review-history'

export const reviewHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  kind: z.enum(reviewHistoryKinds).optional(), action: z.enum(reviewHistoryActions).optional(),
  reviewer: z.string().uuid().optional(), batch: z.string().uuid().optional(),
  query: z.string().trim().max(100).optional(),
  from: z.iso.date().optional(), to: z.iso.date().optional()
}).strict().refine(input => !input.from || !input.to || input.from <= input.to, {
  message: '结束日期不能早于开始日期', path: ['to']
}).transform(({ from, to, ...input }) => ({
  ...input, from: from ? new Date(`${from}T00:00:00+08:00`) : undefined,
  until: to ? new Date(new Date(`${to}T00:00:00+08:00`).getTime() + 86400000) : undefined
}))
