import { createError, getRouterParam, readValidatedBody } from 'h3'
import { z } from 'zod'
import { CmsMemberKeyConflictError, CmsMemberVersionConflictError, updateCmsMember } from '../../../services/cms-members'
import { cmsAccountPattern } from '../../../../shared/types/cms-auth'
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

const memberOptionErrors: Record<string, string> = {
  MEMBER_GRADE_INVALID: '年级不在可选范围内，请重新选择',
  MEMBER_GROUP_INVALID: '组别与年级不匹配，请重新选择',
  MEMBER_SEASON_INVALID: '参加过的赛季中有不可选的新届次，请重新选择',
  MEMBER_ADVISOR_SEASON_INVALID: '顾问届次中有不可选的新届次，请重新选择',
  MEMBER_SEASON_REQUIRED: '请至少选择一个参加过的赛季',
  MEMBER_TEACHER_FIELDS_INVALID: '指导老师不能填写年级、组别、职务或顾问届次',
  MEMBER_GROUP_POSITION_INVALID: '组内职务只能选择一项'
}

const schema = z.object({
  memberKey: z.string().trim().toLowerCase().regex(cmsAccountPattern).optional(),
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
    if (error instanceof CmsMemberKeyConflictError) {
      throw createError({ statusCode: 409, message: error.message })
    }
    if (error instanceof Error && memberOptionErrors[error.message]) {
      throw createError({ statusCode: 400, message: memberOptionErrors[error.message] })
    }
    throw error
  }
  if (!member) throw createError({ statusCode: 404, message: '成员不存在' })
  return { member }
})
