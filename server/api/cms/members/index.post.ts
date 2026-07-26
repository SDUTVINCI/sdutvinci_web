import { createError, readValidatedBody } from 'h3'
import { z } from 'zod'
import { cmsAccountPattern } from '../../../../shared/types/cms-auth'
import { createCmsMember } from '../../../services/cms-members'
import {
  requireCmsCsrf,
  requireCmsRequestAuth
} from '../../../utils/cms-http'

const safeAvatarUrl = z.string().trim().max(2048).refine((value) => {
  if (
    value.startsWith('/')
    && !value.startsWith('//')
    && !value.includes('\\')
    && !/[\u0000-\u001f\u007f]/.test(value)
  ) return true
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol)
      && !url.username
      && !url.password
  } catch {
    return false
  }
}, '头像地址必须是站内路径或 HTTP(S) URL')

const metadataSchema = z.record(z.string(), z.unknown()).refine(
  value => JSON.stringify(value).length <= 100_000,
  '成员元数据不能超过 100 KB'
)

const schema = z.object({
  memberKey: z.string().trim().toLowerCase().regex(cmsAccountPattern),
  name: z.string().trim().min(1).max(100),
  avatarUrl: safeAvatarUrl.nullable().optional(),
  metadata: metadataSchema.optional()
}).strict()

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
