import { listPublicArticlesFromDatabase } from '../../../../services/public-content'
import { getCmsRequestAuth } from '../../../../utils/cms-http'

export default defineEventHandler(async (event) => {
  const auth = await getCmsRequestAuth(event)
  return {
    items: await listPublicArticlesFromDatabase('wiki', {
      includeRestricted: Boolean(auth)
    })
  }
})
