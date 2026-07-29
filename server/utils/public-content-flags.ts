import type {
  PublicContentCandidateEnvironment,
  PublicContentCollection,
  PublicContentSourceConfig,
  PublicContentSourceMode
} from '../../shared/types/public-content'

const sourceModes = new Set<PublicContentSourceMode>([
  'legacy_git',
  'database_shadow',
  'database'
])
const candidateEnvironments = new Set<PublicContentCandidateEnvironment>([
  'disabled',
  'test',
  'staging',
  'production'
])

export class PublicContentConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PublicContentConfigurationError'
  }
}

const runtimeEnvironmentValue = (key: string) =>
  String(Reflect.get(process.env, key) || '').trim()

const sourceEnvironmentKey: Record<PublicContentCollection, string> = {
  news: 'CONTENT_SOURCE_NEWS',
  wiki: 'CONTENT_SOURCE_WIKI',
  members: 'CONTENT_SOURCE_MEMBERS'
}

export const getPublicContentCandidateEnvironment =
  (): PublicContentCandidateEnvironment => {
    const value = runtimeEnvironmentValue('CONTENT_CANDIDATE_ENV')
      || (
        runtimeEnvironmentValue('NODE_ENV') === 'production'
          ? 'production'
          : 'disabled'
      )
    if (!candidateEnvironments.has(value as PublicContentCandidateEnvironment)) {
      throw new PublicContentConfigurationError(
        `CONTENT_CANDIDATE_ENV 不支持值 ${value}`
      )
    }
    if (
      value === 'test'
      && runtimeEnvironmentValue('NODE_ENV') !== 'test'
    ) {
      throw new PublicContentConfigurationError(
        'CONTENT_CANDIDATE_ENV=test 只允许在 NODE_ENV=test 的隔离环境启用'
      )
    }
    if (
      value === 'production'
      && runtimeEnvironmentValue('NODE_ENV') !== 'production'
    ) {
      throw new PublicContentConfigurationError(
        'CONTENT_CANDIDATE_ENV=production 只允许在 NODE_ENV=production 启用'
      )
    }
    return value as PublicContentCandidateEnvironment
  }

export const getPublicContentSourceMode = (
  collection: PublicContentCollection
): PublicContentSourceMode => {
  const key = sourceEnvironmentKey[collection]
  const value = runtimeEnvironmentValue(key)
    || (
      runtimeEnvironmentValue('NODE_ENV') === 'production'
      && collection !== 'members'
        ? 'database'
        : 'legacy_git'
    )
  if (!sourceModes.has(value as PublicContentSourceMode)) {
    throw new PublicContentConfigurationError(`${key} 不支持值 ${value}`)
  }

  const mode = value as PublicContentSourceMode
  const environment = getPublicContentCandidateEnvironment()
  if (
    mode !== 'legacy_git'
    && environment === 'disabled'
  ) {
    throw new PublicContentConfigurationError(
      `${key}=${mode} 只允许在显式 test/staging/production 内容环境启用`
    )
  }
  if (
    environment === 'production'
    && (
      mode === 'database_shadow'
      || (collection === 'members' && mode !== 'legacy_git')
    )
  ) {
    throw new PublicContentConfigurationError(
      `${key}=${mode} 不允许在阶段 5 的 production 权威配置中启用`
    )
  }
  if (environment === 'production' && collection !== 'members') {
    const publishMode =
      runtimeEnvironmentValue('CONTENT_PUBLISH_MODE') || 'database'
    if (!['database', 'legacy_git'].includes(publishMode)) {
      throw new PublicContentConfigurationError(
        `production 不允许 CONTENT_PUBLISH_MODE=${publishMode}`
      )
    }
    const requiredMode = publishMode === 'database' ? 'database' : 'legacy_git'
    if (mode !== requiredMode) {
      throw new PublicContentConfigurationError(
        `${key}=${mode} 与 production 发布权威 ${publishMode} 不一致`
      )
    }
  }
  return mode
}

export const getPublicContentSourceConfig = (): PublicContentSourceConfig => ({
  environment: getPublicContentCandidateEnvironment(),
  sources: {
    news: getPublicContentSourceMode('news'),
    wiki: getPublicContentSourceMode('wiki'),
    members: getPublicContentSourceMode('members')
  }
})

export const assertPublicDatabaseCandidateEnabled = (
  collection: PublicContentCollection
) => {
  const mode = getPublicContentSourceMode(collection)
  if (mode === 'legacy_git') {
    throw new PublicContentConfigurationError(
      `${sourceEnvironmentKey[collection]} 未启用数据库候选`
    )
  }
  return mode
}

export const isPublicDatabaseResponseEnabled = (
  collection: PublicContentCollection
) => getPublicContentSourceMode(collection) === 'database'
