import { createError, getRouterParam, readValidatedBody } from 'h3'
import { z } from 'zod'
import { CmsMemberVersionConflictError, updateCmsMember } from '../../../services/cms-members'
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
  name: z.string().trim().min(1).max(100),
  avatarUrl: safeAvatarUrl.nullable().optional(),
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
  expectedVersion: z.number().int().positive(),
  metadata: metadataSchema.optional()
}).strict()

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event, 'admin')
  requireCmsCsrf(event, auth)
  const id = z.string().uuid().parse(getRouterParam(event, 'id'))
  const input = await readValidatedBody(event, schema.parse)
  let member
  try {
    member = await updateCmsMember(id, input, auth.user.id)
  } catch (error) {
    if (error instanceof CmsMemberVersionConflictError) {
      throw createError({ statusCode: 409, message: error.message })
    }
    throw error
  }
  if (!member) throw createError({ statusCode: 404, message: '成员不存在' })
  return { member }
})
