import { afterEach, describe, expect, it } from 'vitest'
import {
  createCsrfToken,
  verifyCsrfToken
} from '../server/utils/cms-security'
import { resetCmsServerConfigForTests } from '../server/utils/cms-config'
import { isCmsOriginTrusted } from '../server/utils/cms-http'
import {
  describeCmsFailure,
  redactCmsSensitiveText
} from '../server/utils/cms-sensitive-data'
import { assertCmsTestDatabaseIsolation } from './helpers/cms-test-database'

const originalEnvironment = {
  CMS_AUTH_SECRET: process.env.CMS_AUTH_SECRET,
  DATABASE_URL: process.env.DATABASE_URL,
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
  CONTENT_PR_BRANCH_CLEANUP_GITHUB_TOKEN: process.env.CONTENT_PR_BRANCH_CLEANUP_GITHUB_TOKEN
}

const restoreEnvironmentValue = (
  key: keyof typeof originalEnvironment,
  value: string | undefined
) => {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

describe('CMS 通用安全边界', () => {
  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnvironment)) {
      restoreEnvironmentValue(
        key as keyof typeof originalEnvironment,
        value
      )
    }
    resetCmsServerConfigForTests()
  })

  it('CSRF Token 与会话绑定且使用恒定时间比较', () => {
    process.env.CMS_AUTH_SECRET = 'test-only-secret-with-at-least-32-characters'
    resetCmsServerConfigForTests()
    const token = createCsrfToken('session-a')
    expect(verifyCsrfToken('session-a', token)).toBe(true)
    expect(verifyCsrfToken('session-b', token)).toBe(false)
    expect(verifyCsrfToken('session-a', undefined)).toBe(false)
  })

  it('仅接受请求自身或显式配置的完整 Origin', () => {
    expect(isCmsOriginTrusted(
      'https://cms.example',
      'http://app-blue:3000',
      'https://cms.example'
    )).toBe(true)
    expect(isCmsOriginTrusted(
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3000',
      'https://cms.example'
    )).toBe(true)
    expect(isCmsOriginTrusted(
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'https://cms.example'
    )).toBe(false)
  })

  it('日志与持久化失败原因会遮盖凭据、Token 和私钥', () => {
    process.env.DATABASE_URL = 'postgresql://cms:super-secret@postgres:5432/cms'
    process.env.S3_ACCESS_KEY_ID = 'phase9-test-access-key'
    process.env.S3_SECRET_ACCESS_KEY = 's3-secret-value'
    process.env.CONTENT_PR_BRANCH_CLEANUP_GITHUB_TOKEN = 'github_pat_cleanup-secret-test-value'
    const privateKey = [
      '-----BEGIN OPENSSH PRIVATE KEY-----',
      'private-material',
      '-----END OPENSSH PRIVATE KEY-----'
    ].join('\n')
    const raw = [
      process.env.DATABASE_URL,
      process.env.S3_ACCESS_KEY_ID,
      process.env.S3_SECRET_ACCESS_KEY,
      process.env.CONTENT_PR_BRANCH_CLEANUP_GITHUB_TOKEN,
      'Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz123456',
      'github_pat_abcdefghijklmnopqrstuvwxyz123456',
      'ASIAABCDEFGHIJKLMNOP',
      privateKey
    ].join('\n')
    const redacted = redactCmsSensitiveText(raw)
    expect(redacted).not.toContain('super-secret')
    expect(redacted).not.toContain('phase9-test-access-key')
    expect(redacted).not.toContain('s3-secret-value')
    expect(redacted).not.toContain('cleanup-secret-test-value')
    expect(redacted).not.toContain('abcdefghijklmnopqrstuvwxyz')
    expect(redacted).not.toContain('ASIAABCDEFGHIJKLMNOP')
    expect(redacted).not.toContain('private-material')

    const failure = Object.assign(new Error('push failed'), {
      stderr: `remote: ${raw}`
    })
    expect(describeCmsFailure(failure)).not.toContain('super-secret')
  })

  it('破坏性集成测试拒绝复用应用数据库', () => {
    const acceptanceUrl =
      'postgresql://acceptance:secret@127.0.0.1:5432/vinci_phase2_acceptance_test'
    expect(() => assertCmsTestDatabaseIsolation(
      acceptanceUrl,
      acceptanceUrl
    )).toThrow('TEST_DATABASE_URL 不得与 DATABASE_URL 指向同一数据库')
    expect(() => assertCmsTestDatabaseIsolation(
      'postgresql://automated:secret@127.0.0.1:5432/vinci_phase2_automated_test',
      acceptanceUrl
    )).not.toThrow()
  })
})
