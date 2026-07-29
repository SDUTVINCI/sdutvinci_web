import { createError, getRouterParam } from 'h3'
import { getPublicMemberFromDatabase } from '../../../../services/public-content'
import { requirePublicDatabaseCandidate } from '../../../../utils/public-content-http'

export default defineEventHandler(async (event) => {
  requirePublicDatabaseCandidate('members')
  const slug = decodeURIComponent(String(getRouterParam(event, 'slug') || ''))
  const member = await getPublicMemberFromDatabase(slug)
  if (!member) {
    throw createError({ statusCode: 404, message: '成员不存在' })
  }
  return { item: member }
})
