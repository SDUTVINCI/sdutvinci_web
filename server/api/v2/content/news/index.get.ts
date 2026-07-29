import { listPublicArticlesFromDatabase } from '../../../../services/public-content'
import { requirePublicDatabaseCandidate } from '../../../../utils/public-content-http'

export default defineEventHandler(async () => {
  requirePublicDatabaseCandidate('news')
  return {
    items: await listPublicArticlesFromDatabase('news')
  }
})
