import { getValidatedQuery } from 'h3'
import { z } from 'zod'
import { getCmsNewWikiDocumentPathAvailability } from '../../../services/cms-drafts'
import { requireCmsRequestAuth } from '../../../utils/cms-http'

const schema = z.object({
  documentDate: z.string().trim().max(10),
  documentName: z.string().trim().max(500)
}).strict()

export default defineEventHandler(async (event) => {
  await requireCmsRequestAuth(event)
  const query = await getValidatedQuery(event, schema.parse)
  return getCmsNewWikiDocumentPathAvailability(query.documentDate, query.documentName)
})
