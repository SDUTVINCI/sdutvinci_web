import { createHash } from 'node:crypto'

const cmsMediaHashLength = 8

export const createCmsMediaContentHash = (data: Uint8Array) =>
  createHash('sha256').update(data).digest('hex')

export const createCmsMediaObjectKey = (
  prefix: string,
  draftId: string,
  output: Uint8Array,
  now = new Date()
) => {
  const timestamp = now.getTime()
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new Error('CMS_MEDIA_TIMESTAMP_INVALID')
  }

  const contentHash = createCmsMediaContentHash(output)
  return [
    prefix,
    now.getUTCFullYear().toString(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    draftId,
    `${timestamp}-${contentHash.slice(0, cmsMediaHashLength)}.webp`
  ].join('/')
}
