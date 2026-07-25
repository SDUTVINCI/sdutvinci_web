import {
  createError,
  getHeader,
  readMultipartFormData
} from 'h3'
import { z, ZodError } from 'zod'
import type { CmsMediaUploadResponse } from '../../../shared/types/cms-media'
import {
  CmsMediaDraftError,
  CmsMediaStorageError,
  CmsMediaValidationError,
  uploadCmsImage
} from '../../services/cms-media'
import { CmsEditLockLostError } from '../../services/cms-edit-locks'
import {
  requireCmsCsrf,
  requireCmsRequestAuth
} from '../../utils/cms-http'
import { getCmsMediaConfig } from '../../utils/cms-media-config'

const uploadFieldsSchema = z.object({
  draftId: z.string().uuid(),
  lockLeaseId: z.string().uuid(),
  altText: z.string().trim().max(200).optional()
})

const fieldValue = (
  parts: NonNullable<Awaited<ReturnType<typeof readMultipartFormData>>>,
  name: string
) => {
  const matches = parts.filter(part => part.name === name && !part.filename)
  if (matches.length > 1) {
    throw createError({ statusCode: 400, message: `字段 ${name} 不能重复` })
  }
  return matches[0]?.data.toString('utf8')
}

export default defineEventHandler(async (event): Promise<CmsMediaUploadResponse> => {
  const auth = await requireCmsRequestAuth(event)
  requireCmsCsrf(event, auth)

  let config
  try {
    config = getCmsMediaConfig()
  } catch (error) {
    if (error instanceof ZodError) {
      throw createError({
        statusCode: 503,
        message: '图片存储尚未正确配置'
      })
    }
    throw error
  }

  const contentLength = Number(getHeader(event, 'content-length'))
  if (
    Number.isFinite(contentLength)
    && contentLength > config.CMS_IMAGE_MAX_BYTES + 1024 * 1024
  ) {
    throw createError({
      statusCode: 413,
      message: `图片不能超过 ${Math.floor(config.CMS_IMAGE_MAX_BYTES / 1024 / 1024)} MiB`
    })
  }

  const parts = await readMultipartFormData(event)
  if (!parts) {
    throw createError({
      statusCode: 400,
      message: '请求必须使用 multipart/form-data'
    })
  }
  const files = parts.filter(part => part.name === 'image' && part.filename)
  if (files.length !== 1) {
    throw createError({ statusCode: 400, message: '每次必须上传且只能上传一张图片' })
  }
  const file = files[0]!
  const fieldsResult = uploadFieldsSchema.safeParse({
    draftId: fieldValue(parts, 'draftId'),
    lockLeaseId: fieldValue(parts, 'lockLeaseId'),
    altText: fieldValue(parts, 'altText') || undefined
  })
  if (!fieldsResult.success) {
    throw createError({
      statusCode: 400,
      message: '草稿、编辑租约或图片说明无效'
    })
  }
  const fields = fieldsResult.data

  try {
    return await uploadCmsImage({
      ...fields,
      uploaderUserId: auth.user.id,
      isAdmin: auth.user.roles.includes('admin'),
      filename: file.filename!,
      mimeType: file.type || '',
      data: file.data
    })
  } catch (error) {
    if (error instanceof CmsMediaValidationError) {
      const messages = {
        IMAGE_EMPTY: '图片内容为空',
        IMAGE_TOO_LARGE: `图片不能超过 ${Math.floor(config.CMS_IMAGE_MAX_BYTES / 1024 / 1024)} MiB`,
        IMAGE_TYPE_UNSUPPORTED: '仅支持 JPEG/JPG、PNG、WebP 和 GIF 图片，文件内容必须能被安全识别',
        IMAGE_INVALID: '图片无法安全解码或内容已损坏'
      }
      throw createError({
        statusCode: error.code === 'IMAGE_TOO_LARGE' ? 413 : 415,
        message: messages[error.code]
      })
    }
    if (error instanceof CmsMediaDraftError) {
      throw createError({
        statusCode: error.code === 'DRAFT_NOT_FOUND' ? 404 : 409,
        message: error.code === 'DRAFT_NOT_FOUND'
          ? '草稿不存在'
          : '当前草稿状态不允许上传图片'
      })
    }
    if (error instanceof CmsEditLockLostError) {
      throw createError({
        statusCode: 409,
        message: '编辑锁已失效，不能上传图片'
      })
    }
    if (error instanceof CmsMediaStorageError) {
      throw createError({
        statusCode: 502,
        message: '图片存储服务暂时不可用，请稍后重试'
      })
    }
    throw error
  }
})
