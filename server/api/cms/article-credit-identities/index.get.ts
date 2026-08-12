import { listCmsArticleCreditIdentities } from '../../../services/article-credit-identities'
import { requireCmsRequestAuth } from '../../../utils/cms-http'

export default defineEventHandler(async (event) => {
  await requireCmsRequestAuth(event, 'admin')
  return { items: await listCmsArticleCreditIdentities() }
})
