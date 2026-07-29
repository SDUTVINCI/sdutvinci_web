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
  'staging'
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
    const value = runtimeEnvironmentValue('CONTENT_CANDIDATE_ENV') || 'disabled'
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
    return value as PublicContentCandidateEnvironment
  }

export const getPublicContentSourceMode = (
  collection: PublicContentCollection
): PublicContentSourceMode => {
  const key = sourceEnvironmentKey[collection]
  const value = runtimeEnvironmentValue(key) || 'legacy_git'
  if (!sourceModes.has(value as PublicContentSourceMode)) {
    throw new PublicContentConfigurationError(`${key} 不支持值 ${value}`)
  }

  const mode = value as PublicContentSourceMode
  if (
    mode !== 'legacy_git'
    && getPublicContentCandidateEnvironment() === 'disabled'
  ) {
    throw new PublicContentConfigurationError(
      `${key}=${mode} 只允许在显式 phase4 test/staging 候选环境启用`
    )
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
