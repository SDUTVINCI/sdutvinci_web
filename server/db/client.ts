import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

type CmsDatabase = NodePgDatabase<typeof schema>

interface DatabaseState {
  pool: Pool
  db: CmsDatabase
}

const globalDatabase = globalThis as typeof globalThis & {
  __vinciCmsDatabase?: DatabaseState
}

const parsePoolMax = () => {
  const value = Number.parseInt(process.env.DATABASE_POOL_MAX || '10', 10)
  return Number.isFinite(value) && value > 0 ? value : 10
}

const createDatabaseState = (): DatabaseState => {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is required.')
  }

  const pool = new Pool({
    connectionString,
    max: parsePoolMax(),
    ssl: process.env.DATABASE_SSL === 'true'
      ? { rejectUnauthorized: true }
      : undefined
  })

  return {
    pool,
    db: drizzle(pool, { schema })
  }
}

const getDatabaseState = () => {
  globalDatabase.__vinciCmsDatabase ||= createDatabaseState()
  return globalDatabase.__vinciCmsDatabase
}

export const getDatabase = () => getDatabaseState().db
export const getDatabasePool = () => getDatabaseState().pool

export const closeDatabase = async () => {
  const state = globalDatabase.__vinciCmsDatabase
  if (!state) return

  delete globalDatabase.__vinciCmsDatabase
  await state.pool.end()
}
