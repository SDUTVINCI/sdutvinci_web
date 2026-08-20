import {
  listPublicArticlesFromDatabase,
  listRestrictedWikiDocumentsFromDatabase
} from '../../../../services/public-content'
import { getCmsRequestAuth } from '../../../../utils/cms-http'

export default defineEventHandler(async (event) => {
  const auth = await getCmsRequestAuth(event)
  const includeRestricted = Boolean(auth)
  const [items, restrictedDocuments] = await Promise.all([
    listPublicArticlesFromDatabase('wiki', { includeRestricted }),
    includeRestricted
      ? Promise.resolve([])
      : listRestrictedWikiDocumentsFromDatabase()
  ])

  return {
    items,
    restrictedDocuments
  }
})
