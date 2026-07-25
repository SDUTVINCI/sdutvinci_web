import { closeDatabase } from '../server/db/client'
import { runMigrations } from '../server/db/migrate'

try {
  await runMigrations()
  console.log('CMS database migrations completed.')
} catch (error) {
  console.error('CMS database migration failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await closeDatabase()
}
