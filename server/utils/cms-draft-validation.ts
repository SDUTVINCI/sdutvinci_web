import { z } from 'zod'
import { cmsAccountPattern } from '../../shared/types/cms-auth'

export const cmsDraftSaveSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000),
  body: z.string().max(4_000_000),
  authorKeys: z.array(
    z.string().trim().toLowerCase().regex(cmsAccountPattern)
  ).max(30),
  version: z.number().int().positive(),
  lockLeaseId: z.string().uuid()
}).strict()
