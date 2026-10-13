import { createError, readMultipartFormData } from 'h3'
import { z } from 'zod'
import { uploadOwnMemberAvatar } from '../../../services/member-self-profile'
import { requireCmsCsrf, requireSiteRequestAuth, throwCmsRateLimitError } from '../../../utils/cms-http'
import { throwMemberProfileError } from '../../../utils/member-profile-http'
import { consumeCmsMediaUploadLimit, CmsRateLimitError } from '../../../services/cms-rate-limits'

export default defineEventHandler(async event => {
  const auth = await requireSiteRequestAuth(event)
  requireCmsCsrf(event, auth)
  try { await consumeCmsMediaUploadLimit(auth.user.id) }
  catch (error) { if (error instanceof CmsRateLimitError) throwCmsRateLimitError(event, error); throw error }
  const parts = await readMultipartFormData(event)
  const files = parts?.filter(part => part.name === 'image' && part.filename) || []
  const version = parts?.find(part => part.name === 'expectedVersion' && !part.filename)
  const name = parts?.find(part => part.name === 'name' && !part.filename)
  if (files.length !== 1 || !version || !name || parts?.some(part => !['image', 'expectedVersion', 'name'].includes(part.name || ''))) {
    throw createError({ statusCode: 400, message: '头像上传字段无效' })
  }
  try { return await uploadOwnMemberAvatar(auth.user, {
    expectedVersion: z.coerce.number().int().positive().parse(version.data.toString('utf8')),
    name: z.string().trim().min(1).max(100).parse(name.data.toString('utf8')),
    data: files[0]!.data, mimeType: files[0]!.type || ''
  }) } catch (error) { throwMemberProfileError(error) }
})
