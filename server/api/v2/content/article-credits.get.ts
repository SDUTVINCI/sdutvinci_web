import { getQuery } from 'h3'
import { z } from 'zod'
import { cmsAccountPattern } from '../../../../shared/types/cms-auth'
import { listPublicArticleCreditIdentities } from '../../../services/article-credit-identities'

const schema = z.string().max(3299).transform(value => value
  .split(',')
  .map(item => item.trim().toLowerCase())
  .filter(Boolean)
).pipe(z.array(z.string().regex(cmsAccountPattern)).max(100))

export default defineEventHandler(async (event) => {
  const keys = schema.parse(String(getQuery(event).keys || ''))
  return { items: await listPublicArticleCreditIdentities(keys) }
})
