export const cmsAcceptedImageTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif'
] as const

export type CmsAcceptedImageType = typeof cmsAcceptedImageTypes[number]

export interface CmsMediaAsset {
  id: string
  draftId: string
  url: string
  originalFilename: string
  originalMimeType: CmsAcceptedImageType
  originalByteSize: number
  width: number
  height: number
  byteSize: number
  createdAt: string
}

export interface CmsMediaUploadResponse {
  asset: CmsMediaAsset
  markdown: string
}
