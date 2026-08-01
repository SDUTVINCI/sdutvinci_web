import { listPublicArticlesFromDatabase } from '../../../../services/public-content'

export default defineEventHandler(async () => {
  return {
    items: await listPublicArticlesFromDatabase('wiki')
  }
})
