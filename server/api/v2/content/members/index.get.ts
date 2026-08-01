import { listPublicMembersFromDatabase } from '../../../../services/public-content'

export default defineEventHandler(async () => {
  return {
    items: await listPublicMembersFromDatabase()
  }
})
