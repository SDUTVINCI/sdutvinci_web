import { z } from 'zod'
import { cmsAccountPattern } from '../../shared/types/cms-auth'
import { WIKI_DOCUMENT_TAGS } from '../../shared/utils/wiki-tags'

export const cmsDraftSaveSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000),
  body: z.string().max(4_000_000),
  authorKeys: z.array(
    z.string().trim().toLowerCase().regex(cmsAccountPattern)
  ).max(1),
  contributorKeys: z.array(
    z.string().trim().toLowerCase().regex(cmsAccountPattern)
  ).max(100),
  updatedAtOverride: z.string().datetime({ offset: true }).nullable(),
  publishedAtOverride: z.string().datetime({ offset: true }).nullable(),
  wikiTags: z.array(z.enum(WIKI_DOCUMENT_TAGS)).max(WIKI_DOCUMENT_TAGS.length).optional(),
  version: z.number().int().positive(),
  lockLeaseId: z.string().uuid()
}).strict()
