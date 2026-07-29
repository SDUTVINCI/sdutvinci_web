import { listPublicMembersFromDatabase } from '../../../../services/public-content'
import { requirePublicDatabaseCandidate } from '../../../../utils/public-content-http'

export default defineEventHandler(async () => {
  requirePublicDatabaseCandidate('members')
  return {
    items: await listPublicMembersFromDatabase()
  }
})
