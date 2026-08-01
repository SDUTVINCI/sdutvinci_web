import { getRouterParam, readValidatedBody } from 'h3'
import { z } from 'zod'
import { importContentPrItems } from '../../../../services/content-pr-import'
import { requireCmsCsrf } from '../../../../utils/cms-http'
import { requireContentImportAuth, throwContentImportHttpError } from '../../../../utils/content-import-http'

const schema = z.object({ itemIds: z.array(z.string().uuid()).min(1).max(200) }).strict()

export default defineEventHandler(async (event) => {
  const auth = await requireContentImportAuth(event)
  requireCmsCsrf(event, auth)
  const input = await readValidatedBody(event, schema.parse)
  try {
    return await importContentPrItems(getRouterParam(event, 'id') || '', input.itemIds, auth.user.id)
  } catch (error) {
    throwContentImportHttpError(error)
  }
})
