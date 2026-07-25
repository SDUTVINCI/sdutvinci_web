import { createError, getRouterParam, readValidatedBody } from 'h3'
import { z } from 'zod'
import { updateCmsMember } from '../../../services/cms-members'
import {
  requireCmsCsrf,
  requireCmsRequestAuth
} from '../../../utils/cms-http'

const schema = z.object({
  name: z.string().trim().min(1).max(100),
  avatarUrl: z.string().trim().max(2048).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
})

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event, 'admin')
  requireCmsCsrf(event, auth)
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const input = await readValidatedBody(event, schema.parse)
  const member = await updateCmsMember(id, input, auth.user.id)
  if (!member) throw createError({ statusCode: 404, message: '成员不存在' })
  return { member }
})
