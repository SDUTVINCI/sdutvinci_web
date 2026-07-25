const testDatabaseUrl = process.env.TEST_DATABASE_URL

export const configureCmsTestDatabase = () => {
  if (!testDatabaseUrl) {
    return false
  }

  const databaseName = decodeURIComponent(new URL(testDatabaseUrl).pathname)
    .replace(/^\/+/, '')

  if (!/(^|[-_])test($|[-_])/.test(databaseName)) {
    throw new Error(
      `TEST_DATABASE_URL 必须指向名称包含 test 的隔离数据库，当前为：${databaseName}`
    )
  }

  process.env.DATABASE_URL = testDatabaseUrl
  return true
}
