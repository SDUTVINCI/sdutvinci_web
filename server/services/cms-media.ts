import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
  type ServiceOutputTypes
} from '@aws-sdk/client-s3'
import { and, eq, isNull } from 'drizzle-orm'
import sharp from 'sharp'
import type {
  CmsAcceptedImageType,
  CmsMediaAsset
} from '../../shared/types/cms-media'
import { cmsAcceptedImageTypes } from '../../shared/types/cms-media'
import { getDatabase } from '../db/client'
import { drafts, mediaAssets } from '../db/schema'
import {
  assertCmsDraftEditLease,
  CmsEditLockLostError
} from './cms-edit-locks'
import { getCmsMediaConfig, type CmsMediaConfig } from '../utils/cms-media-config'
import { createCmsMediaObjectKey } from '../utils/cms-media-object-key'

type CmsTransaction = Parameters<
  Parameters<ReturnType<typeof getDatabase>['transaction']>[0]
>[0]

interface CmsObjectStorageClient {
  send(command: PutObjectCommand | DeleteObjectCommand): Promise<ServiceOutputTypes | unknown>
}

export interface UploadCmsImageInput {
  draftId: string
  uploaderUserId: string
  isAdmin: boolean
  lockLeaseId: string
  filename: string
  mimeType: string
  data: Buffer
  altText?: string
}

export interface UploadCmsImageDependencies {
  config?: CmsMediaConfig
  storageClient?: CmsObjectStorageClient
}

export class CmsMediaValidationError extends Error {
  constructor(
    public readonly code:
      | 'IMAGE_EMPTY'
      | 'IMAGE_TOO_LARGE'
      | 'IMAGE_TYPE_UNSUPPORTED'
      | 'IMAGE_INVALID'
  ) {
    super(code)
  }
}

export class CmsMediaDraftError extends Error {
  constructor(public readonly code: 'DRAFT_NOT_FOUND' | 'DRAFT_STATE_INVALID') {
    super(code)
  }
}

export class CmsMediaStorageError extends Error {
  constructor() {
    super('OBJECT_STORAGE_UPLOAD_FAILED')
  }
}

const decodedFormats: Record<string, CmsAcceptedImageType> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif'
}

const acceptedDeclaredMimeTypes = new Set([
  ...cmsAcceptedImageTypes,
  'image/jpg'
])

const sanitizeOriginalFilename = (filename: string) =>
  filename
    .replace(/[/\\\u0000-\u001f\u007f]/g, '_')
    .trim()
    .slice(0, 255) || 'upload'

const escapeMarkdownAlt = (value: string) =>
  value
    .replace(/[\r\n]+/g, ' ')
    .replace(/[[\]\\]/g, '\\$&')
    .trim()
    .slice(0, 200)

const defaultAltText = (filename: string) =>
  filename.replace(/\.[^.]+$/, '').trim() || '图片'

const createPublicUrl = (baseUrl: string, objectKey: string) => {
  const encodedKey = objectKey
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/')
  return `${baseUrl.replace(/\/+$/, '')}/${encodedKey}`
}

const createStorageClient = (config: CmsMediaConfig): CmsObjectStorageClient =>
  new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY
    }
  })

const validateDraftLease = async (
  tx: CmsTransaction,
  draftId: string,
  uploaderUserId: string,
  isAdmin: boolean,
  lockLeaseId: string
) => {
  const [draft] = await tx
    .select({
      ownerUserId: drafts.ownerUserId,
      status: drafts.status
    })
    .from(drafts)
    .where(and(
      eq(drafts.id, draftId),
      isNull(drafts.deletedAt),
      isAdmin ? undefined : eq(drafts.ownerUserId, uploaderUserId)
    ))
    .limit(1)

  if (!draft) throw new CmsMediaDraftError('DRAFT_NOT_FOUND')
  if (draft.status !== 'draft') throw new CmsMediaDraftError('DRAFT_STATE_INVALID')
  await assertCmsDraftEditLease(tx, draftId, uploaderUserId, lockLeaseId)
}

const transformImage = async (
  data: Buffer,
  declaredMimeType: string,
  config: CmsMediaConfig
) => {
  if (!data.length) throw new CmsMediaValidationError('IMAGE_EMPTY')
  if (data.length > config.CMS_IMAGE_MAX_BYTES) {
    throw new CmsMediaValidationError('IMAGE_TOO_LARGE')
  }
  if (!acceptedDeclaredMimeTypes.has(declaredMimeType.toLowerCase())) {
    throw new CmsMediaValidationError('IMAGE_TYPE_UNSUPPORTED')
  }

  try {
    const source = sharp(data, {
      animated: true,
      failOn: 'error',
      limitInputPixels: 100_000_000
    })
    const metadata = await source.metadata()
    const decodedMimeType = metadata.format
      ? decodedFormats[metadata.format]
      : undefined
    if (
      !decodedMimeType
      || !metadata.width
      || !metadata.height
    ) {
      throw new CmsMediaValidationError('IMAGE_TYPE_UNSUPPORTED')
    }

    const { data: output, info } = await source
      .rotate()
      .resize({
        width: config.CMS_IMAGE_MAX_WIDTH,
        height: config.CMS_IMAGE_MAX_HEIGHT,
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({
        quality: config.CMS_IMAGE_WEBP_QUALITY,
        effort: 4
      })
      .toBuffer({ resolveWithObject: true })

    if (!info.width || !info.height || !output.length) {
      throw new CmsMediaValidationError('IMAGE_INVALID')
    }

    return {
      output,
      width: info.width,
      height: info.pageHeight || info.height,
      decodedMimeType
    }
  } catch (error) {
    if (error instanceof CmsMediaValidationError) throw error
    throw new CmsMediaValidationError('IMAGE_INVALID')
  }
}

const toCmsMediaAsset = (
  row: typeof mediaAssets.$inferSelect
): CmsMediaAsset => ({
  id: row.id,
  draftId: row.draftId,
  url: row.publicUrl,
  originalFilename: row.originalFilename,
  originalMimeType: row.originalMimeType as CmsAcceptedImageType,
  originalByteSize: row.originalByteSize,
  width: row.width,
  height: row.height,
  byteSize: row.byteSize,
  createdAt: row.createdAt.toISOString()
})

export const uploadCmsImage = async (
  input: UploadCmsImageInput,
  dependencies: UploadCmsImageDependencies = {}
) => {
  const config = dependencies.config || getCmsMediaConfig()
  const storageClient = dependencies.storageClient || createStorageClient(config)
  const filename = sanitizeOriginalFilename(input.filename)

  await getDatabase().transaction(tx =>
    validateDraftLease(
      tx,
      input.draftId,
      input.uploaderUserId,
      input.isAdmin,
      input.lockLeaseId
    )
  )

  const transformed = await transformImage(input.data, input.mimeType, config)
  const objectKey = createCmsMediaObjectKey(
    config.S3_KEY_PREFIX,
    input.draftId,
    transformed.output
  )
  const publicUrl = createPublicUrl(config.S3_PUBLIC_BASE_URL, objectKey)

  try {
    await storageClient.send(new PutObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: objectKey,
      Body: transformed.output,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable',
      Metadata: {
        'cms-draft-id': input.draftId,
        'cms-uploader-id': input.uploaderUserId
      }
    }))
  } catch {
    throw new CmsMediaStorageError()
  }

  try {
    const row = await getDatabase().transaction(async (tx) => {
      await validateDraftLease(
        tx,
        input.draftId,
        input.uploaderUserId,
        input.isAdmin,
        input.lockLeaseId
      )
      const [created] = await tx
        .insert(mediaAssets)
        .values({
          draftId: input.draftId,
          uploaderUserId: input.uploaderUserId,
          objectKey,
          publicUrl,
          originalFilename: filename,
          originalMimeType: transformed.decodedMimeType,
          originalByteSize: input.data.length,
          width: transformed.width,
          height: transformed.height,
          byteSize: transformed.output.length
        })
        .returning()
      if (!created) throw new Error('MEDIA_ASSET_INSERT_FAILED')
      return created
    })

    const asset = toCmsMediaAsset(row)
    const alt = escapeMarkdownAlt(input.altText || defaultAltText(filename))
    return {
      asset,
      markdown: `![${alt}](${asset.url})`
    }
  } catch (error) {
    await storageClient.send(new DeleteObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: objectKey
    })).catch(() => undefined)
    if (
      error instanceof CmsMediaDraftError
      || error instanceof CmsEditLockLostError
    ) {
      throw error
    }
    throw new CmsMediaStorageError()
  }
}
