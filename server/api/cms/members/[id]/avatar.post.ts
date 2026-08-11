import { createError, getRouterParam, readMultipartFormData } from 'h3'
import { z } from 'zod'
import { uploadCmsMemberAvatar } from '../../../../services/cms-member-avatar'
import { CmsMemberVersionConflictError } from '../../../../services/cms-members'
import { requireCmsCsrf, requireCmsRequestAuth } from '../../../../utils/cms-http'

export default defineEventHandler(async (event) => {
  const auth = await requireCmsRequestAuth(event, 'admin')
  requireCmsCsrf(event, auth)
  const memberId = z.string().uuid().parse(getRouterParam(event, 'id'))
  const parts = await readMultipartFormData(event)
  const files = parts?.filter(part => part.name === 'image' && part.filename) || []
  const versionPart = parts?.find(part => part.name === 'expectedVersion' && !part.filename)
  if (!parts || files.length !== 1 || !versionPart
    || parts.some(part => !['image', 'expectedVersion'].includes(part.name || ''))) {
    throw createError({ statusCode: 400, message: '头像上传字段无效' })
  }
  try {
    return await uploadCmsMemberAvatar({
      memberId,
      expectedVersion: z.coerce.number().int().positive().parse(versionPart.data.toString('utf8')),
      data: files[0]!.data,
      mimeType: files[0]!.type || '',
      actorUserId: auth.user.id
    })
  } catch (error) {
    if (error instanceof CmsMemberVersionConflictError) {
      throw createError({ statusCode: 409, message: error.message })
    }
    if (error instanceof Error && error.message === 'MEMBER_NOT_FOUND') {
      throw createError({ statusCode: 404, message: '成员不存在' })
    }
    throw createError({ statusCode: 400, message: '头像无效或存储暂不可用' })
  }
})
