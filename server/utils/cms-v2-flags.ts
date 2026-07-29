import { z } from 'zod'

const contentPublishModeSchema = z.enum([
  'legacy_git',
  'revision_shadow',
  'database'
])

export type ContentPublishMode = z.infer<typeof contentPublishModeSchema>

let cachedMode: ContentPublishMode | undefined

export const getContentPublishMode = (): ContentPublishMode => {
  if (!cachedMode) {
    const mode = contentPublishModeSchema.parse(
      process.env.CONTENT_PUBLISH_MODE || 'legacy_git'
    )
    if (mode === 'database') {
      throw new Error('CONTENT_PUBLISH_MODE=database 在 V2 阶段 2 尚不可用')
    }
    if (mode === 'revision_shadow' && process.env.NODE_ENV !== 'test') {
      throw new Error('revision_shadow 只允许在 NODE_ENV=test 的隔离环境启用')
    }
    cachedMode = mode
  }
  return cachedMode
}

export const isCmsRevisionShadowEnabled = () =>
  getContentPublishMode() === 'revision_shadow'

export const assertCmsRevisionShadowEnabled = () => {
  if (!isCmsRevisionShadowEnabled()) {
    throw new Error('CMS_REVISION_SHADOW_DISABLED')
  }
}

export const resetCmsV2FlagsForTests = () => {
  cachedMode = undefined
}
