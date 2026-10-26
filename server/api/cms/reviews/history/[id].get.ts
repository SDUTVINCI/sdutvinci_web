import { createError, getRouterParam, setResponseHeader } from 'h3'
import { z } from 'zod'
import { requireCmsRequestAuth } from '../../../../utils/cms-http'
import { getReviewHistoryDetail } from '../../../../services/cms-review-history'

export default defineEventHandler(async event => {
  await requireCmsRequestAuth(event, 'admin')
  setResponseHeader(event, 'cache-control', 'private, no-store')
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const detail = await getReviewHistoryDetail(id)
  if (!detail) throw createError({ statusCode: 404, message: '审核历史不存在' })
  return detail
})
