import { createError, getRouterParam, readMultipartFormData } from 'h3'
import { uploadMemberApplicationAvatar } from '../../../services/member-applications'

export default defineEventHandler(async (event) => {
  const parts = await readMultipartFormData(event)
  const field = (name: string) => parts?.find(part => part.name === name && !part.filename)?.data.toString('utf8') || ''
  const files = parts?.filter(part => part.name === 'image' && part.filename) || []
  if (!parts || files.length !== 1 || parts.some(part => !['image', 'token', 'name'].includes(part.name || ''))) throw createError({ statusCode: 400, message: '头像上传字段无效' })
  try { return await uploadMemberApplicationAvatar({ id: String(getRouterParam(event, 'id')), token: field('token'), name: field('name'), data: files[0]!.data, mimeType: files[0]!.type || '' }) }
  catch { throw createError({ statusCode: 400, message: '头像无效、申请已过期或存储暂不可用' }) }
})
