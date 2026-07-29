const testDatabaseUrl = process.env.TEST_DATABASE_URL
const applicationDatabaseUrl = process.env.DATABASE_URL

const databaseTarget = (value: string) => {
  const parsed = new URL(value)
  const databaseName = decodeURIComponent(parsed.pathname).replace(/^\/+/, '')
  const port = parsed.port || '5432'
  return {
    databaseName,
    identity: `${parsed.protocol}//${parsed.hostname.toLowerCase()}:${port}/${databaseName}`
  }
}

export const assertCmsTestDatabaseIsolation = (
  candidateUrl: string,
  protectedApplicationUrl?: string
) => {
  const candidate = databaseTarget(candidateUrl)

  if (!/(^|[-_])test($|[-_])/.test(candidate.databaseName)) {
    throw new Error(
      `TEST_DATABASE_URL 必须指向名称包含 test 的隔离数据库，当前为：${candidate.databaseName}`
    )
  }

  if (
    protectedApplicationUrl
    && candidate.identity === databaseTarget(protectedApplicationUrl).identity
  ) {
    throw new Error(
      'TEST_DATABASE_URL 不得与 DATABASE_URL 指向同一数据库；集成测试会清空 CMS 业务表'
    )
  }
}

export const configureCmsTestDatabase = () => {
  delete process.env.DATABASE_URL

  if (!testDatabaseUrl) {
    return false
  }

  assertCmsTestDatabaseIsolation(testDatabaseUrl, applicationDatabaseUrl)

  process.env.DATABASE_URL = testDatabaseUrl
  return true
}
