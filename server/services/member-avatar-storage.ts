import { createHash } from 'node:crypto'
import { CopyObjectCommand, DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import sharp from 'sharp'
import { getCmsMediaConfig } from '../utils/cms-media-config'

const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

const storage = () => {
  const config = getCmsMediaConfig()
  return {
    config,
    client: new S3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY_ID,
        secretAccessKey: config.S3_SECRET_ACCESS_KEY
      }
    })
  }
}

const publicUrl = (base: string, key: string) =>
  `${base.replace(/\/$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`

export const prepareMemberAvatar = async (input: {
  name: string
  data: Buffer
  mimeType: string
}) => {
  const name = input.name.normalize('NFC').replace(/[/\\\u0000-\u001f\u007f]/g, '').trim().slice(0, 100)
  if (!name || input.data.length > 10 * 1024 * 1024 || !allowedMimeTypes.has(input.mimeType)) {
    throw new Error('MEMBER_AVATAR_IMAGE_INVALID')
  }
  const output = await sharp(input.data, {
    animated: true,
    failOn: 'error',
    limitInputPixels: 100_000_000
  }).rotate().resize({
    width: 1600,
    height: 1600,
    fit: 'inside',
    withoutEnlargement: true
  }).webp({ quality: 82, effort: 4 }).toBuffer()
  const hash = createHash('sha256').update(output).digest('hex').slice(0, 8)
  return { output, filename: `${name}-${hash}.webp` }
}

export const uploadMemberAvatarObject = async (input: {
  key: string
  output: Buffer
  metadata?: Record<string, string>
  cacheControl?: string
}) => {
  const { config, client } = storage()
  await client.send(new PutObjectCommand({
    Bucket: config.S3_BUCKET,
    Key: input.key,
    Body: input.output,
    ContentType: 'image/webp',
    CacheControl: input.cacheControl || 'public, max-age=31536000, immutable',
    Metadata: input.metadata
  }))
  return { url: publicUrl(config.S3_PUBLIC_BASE_URL, input.key) }
}

export const deleteMemberAvatarObject = async (key: string) => {
  const { config, client } = storage()
  await client.send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: key }))
}

export const promoteMemberApplicationAvatar = async (input: {
  sourceKey: string
  applicationId: string
}) => {
  if (!/^member-applications\/\d{4}\/[^\u0000/\\]+-[0-9a-f]{8}\.webp$/u.test(input.sourceKey)) {
    throw new Error('MEMBER_APPLICATION_AVATAR_KEY_INVALID')
  }
  const filename = input.sourceKey.split('/').at(-1)!
  const key = `site-assets/images/member_photo/${filename}`
  const { config, client } = storage()
  await client.send(new CopyObjectCommand({
    Bucket: config.S3_BUCKET,
    Key: key,
    CopySource: encodeURIComponent(`${config.S3_BUCKET}/${input.sourceKey}`).replace(/%2F/g, '/'),
    ContentType: 'image/webp',
    CacheControl: 'public, max-age=31536000, immutable',
    MetadataDirective: 'REPLACE',
    Metadata: { 'member-application-id': input.applicationId }
  }))
  return { key, url: publicUrl(config.S3_PUBLIC_BASE_URL, key) }
}
