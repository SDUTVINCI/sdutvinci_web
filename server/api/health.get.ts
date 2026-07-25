import { getDatabasePool } from '../db/client'

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'no-store')

  try {
    await getDatabasePool().query('select 1')
    return {
      status: 'ok',
      database: 'ok'
    }
  } catch {
    setResponseStatus(event, 503)
    return {
      status: 'unavailable',
      database: 'unavailable'
    }
  }
})
