import { createError, readValidatedBody } from 'h3'
import { z } from 'zod'
import { cmsAccountPattern } from '../../../../shared/types/cms-auth'
import { createCmsMember } from '../../../services/cms-members'
import {
  requireCmsCsrf,
  requireCmsRequestAuth
} from '../../../utils/cms-http'

const schema = z.object({
  memberKey: z.string().trim().toLowerCase().regex(cmsAccountPattern),
  name: z.string().trim().min(1).max(100),
  avatarUrl: z.string().trim().max(2048).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
})

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event, 'admin')
  requireCmsCsrf(event, auth)
  const input = await readValidatedBody(event, schema.parse)
  try {
    return { member: await createCmsMember(input, auth.user.id) }
  } catch (error) {
    if (
      typeof error === 'object'
      && error !== null
      && 'code' in error
      && (error.code === '23505' || error.code === 'EEXIST')
    ) {
      throw createError({ statusCode: 409, message: '该成员 ID 已存在' })
    }
    throw error
  }
})
