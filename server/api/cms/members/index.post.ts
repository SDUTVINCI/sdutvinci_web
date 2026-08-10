import { createError, readValidatedBody } from 'h3'
import { z } from 'zod'
import { cmsAccountPattern } from '../../../../shared/types/cms-auth'
import { createCmsMember } from '../../../services/cms-members'
import { isSafeMemberAvatarUrl } from '../../../services/member-profile'
import {
  requireCmsCsrf,
  requireCmsRequestAuth
} from '../../../utils/cms-http'

const safeAvatarUrl = z.string().trim().max(2048)
  .refine(value => isSafeMemberAvatarUrl(value), '头像地址不安全')

const metadataSchema = z.record(z.string(), z.unknown()).refine(
  value => JSON.stringify(value).length <= 100_000,
  '成员元数据不能超过 100 KB'
)

const schema = z.object({
  memberKey: z.string().trim().toLowerCase().regex(cmsAccountPattern),
  name: z.string().trim().min(1).max(100),
  avatarUrl: safeAvatarUrl.nullable().optional(),
  sourcePath: z.string().trim().max(400).optional(),
  role: z.string().trim().max(100).nullable().optional(),
  memberType: z.string().trim().max(100).nullable().optional(),
  groupName: z.string().trim().max(64).nullable().optional(),
  positions: z.array(z.enum(['队长', '副队长', '组长', '机电创新学会会长', '指导老师', '成员', '顾问'])).max(7).optional(),
  seasons: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
  advisorSeasons: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
  grade: z.string().trim().max(100).nullable().optional(),
  affiliation: z.string().trim().max(200).nullable().optional(),
  links: z.record(z.string(), z.string().trim().max(2048).nullable()).optional(),
  body: z.string().max(1_000_000).optional(),
  sortOrder: z.number().int().min(0).max(1_000_000).optional(),
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
