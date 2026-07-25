import { closeDatabase } from '../server/db/client'
import { runMigrations } from '../server/db/migrate'
import { synchronizeCmsArticles } from '../server/services/cms-articles'
import { synchronizeCmsMembers } from '../server/services/cms-members'

try {
  await runMigrations()
  const memberCount = await synchronizeCmsMembers(true)
  const articleCount = await synchronizeCmsArticles()
  console.log(`CMS content synchronized: ${memberCount} members, ${articleCount} articles.`)
} catch (error) {
  console.error(
    'CMS content synchronization failed:',
    error instanceof Error ? error.message : error
  )
  process.exitCode = 1
} finally {
  await closeDatabase()
}
