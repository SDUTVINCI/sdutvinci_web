import { closeDatabase } from '../server/db/client'
import { runMigrations } from '../server/db/migrate'
import { synchronizeCmsArticles } from '../server/services/cms-articles'

try {
  await runMigrations()
  const articleCount = await synchronizeCmsArticles()
  console.log(`CMS content synchronized: ${articleCount} articles. Members are database-authoritative; use v2:members:migrate explicitly.`)
} catch (error) {
  console.error(
    'CMS content synchronization failed:',
    error instanceof Error ? error.message : error
  )
  process.exitCode = 1
} finally {
  await closeDatabase()
}
