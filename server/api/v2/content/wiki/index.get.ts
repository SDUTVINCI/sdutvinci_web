import { listPublicWikiIndexFromDatabase } from '../../../../services/public-content'
import { getCmsRequestAuth } from '../../../../utils/cms-http'

export default defineEventHandler(async (event) => {
  const auth = await getCmsRequestAuth(event)
  return listPublicWikiIndexFromDatabase({ includeRestricted: Boolean(auth) })
})
