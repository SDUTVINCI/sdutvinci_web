import { z } from 'zod'

const contentPublishModeSchema = z.enum([
  'legacy_git',
  'revision_shadow',
  'database'
])

export type ContentPublishMode = z.infer<typeof contentPublishModeSchema>

export class CmsV2ConfigurationError extends Error {}

let cachedMode: ContentPublishMode | undefined

// Keep this as reflective runtime access. The production bundler folds direct
// NODE_ENV property access to its build-time value, while phase 2 acceptance
// deliberately runs a production build inside a runtime test boundary.
export const getCmsRuntimeNodeEnvironment = () =>
  Reflect.get(process.env, 'NODE_ENV') as string | undefined

export const getContentPublishMode = (): ContentPublishMode => {
  if (!cachedMode) {
    const mode = contentPublishModeSchema.parse(
      process.env.CONTENT_PUBLISH_MODE || 'legacy_git'
    )
    if (mode === 'database') {
      throw new CmsV2ConfigurationError(
        'CONTENT_PUBLISH_MODE=database 在 V2 阶段 2 尚不可用'
      )
    }
    if (mode === 'revision_shadow' && getCmsRuntimeNodeEnvironment() !== 'test') {
      throw new CmsV2ConfigurationError(
        'revision_shadow 只允许在 NODE_ENV=test 的隔离环境启用'
      )
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
