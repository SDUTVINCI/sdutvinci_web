import { createError, getRouterParam } from 'h3'
import { z } from 'zod'
import { getCmsMember } from '../../../services/cms-members'
import { requireCmsRequestAuth } from '../../../utils/cms-http'

export default defineEventHandler(async (event) => {
  await requireCmsRequestAuth(event)
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const member = await getCmsMember(id)
  if (!member) throw createError({ statusCode: 404, message: '成员不存在' })
  return { member }
})
