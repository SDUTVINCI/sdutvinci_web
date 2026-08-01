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
      process.env.CONTENT_PUBLISH_MODE
      || 'database'
    )
    if (mode !== 'database' && getCmsRuntimeNodeEnvironment() !== 'test') {
      throw new CmsV2ConfigurationError(
        `${mode} 只允许在 NODE_ENV=test 的隔离回归测试中启用；正式运行固定为 database`
      )
    }
    cachedMode = mode
  }
  return cachedMode
}

export const isCmsRevisionShadowEnabled = () =>
  getContentPublishMode() === 'revision_shadow'

export const isCmsDatabaseAuthorityEnabled = () =>
  getContentPublishMode() === 'database'

export const isCmsRevisionHistoryEnabled = () =>
  ['revision_shadow', 'database'].includes(getContentPublishMode())

export const assertCmsRevisionShadowEnabled = () => {
  if (!isCmsRevisionShadowEnabled()) {
    throw new Error('CMS_REVISION_SHADOW_DISABLED')
  }
}

export const assertCmsRevisionHistoryEnabled = () => {
  if (!isCmsRevisionHistoryEnabled()) {
    throw new Error('CMS_REVISION_HISTORY_DISABLED')
  }
}

export const resetCmsV2FlagsForTests = () => {
  cachedMode = undefined
}
