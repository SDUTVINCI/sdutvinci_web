import { getRouterParam, readValidatedBody } from 'h3'
import { importContentPrItems } from '../../../../services/content-pr-import'
import { requireCmsCsrf } from '../../../../utils/cms-http'
import { requireContentImportAuth, throwContentImportHttpError } from '../../../../utils/content-import-http'
import { contentImportSelectionSchema } from '../../../../utils/content-import-request'

export default defineEventHandler(async (event) => {
  const auth = await requireContentImportAuth(event)
  requireCmsCsrf(event, auth)
  const input = await readValidatedBody(event, contentImportSelectionSchema().parse)
  try {
    return await importContentPrItems(
      getRouterParam(event, 'id') || '',
      input.itemIds,
      auth.user.id,
      {
        forceHighRiskItemIds: input.forceHighRiskItemIds,
        highRiskConfirmation: input.highRiskConfirmation
      }
    )
  } catch (error) {
    throwContentImportHttpError(error)
  }
})
