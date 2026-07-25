import { resolve } from 'node:path'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { getDatabase } from './client'

export const runMigrations = async (
  migrationsFolder = resolve(process.cwd(), 'server/db/migrations')
) => {
  await migrate(getDatabase(), { migrationsFolder })
}
