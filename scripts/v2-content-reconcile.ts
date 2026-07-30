import { closeDatabase } from '../server/db/client'
import { runContentReconciliation } from '../server/services/content-reconciliation'
import { describeCmsFailure } from '../server/utils/cms-sensitive-data'

const trigger = process.argv.includes('--scheduled') ? 'schedule' : 'manual'

try {
  const result = await runContentReconciliation(trigger)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (result.state === 'busy') process.exitCode = 75
} catch (error) {
  process.stderr.write(`${describeCmsFailure(error)}\n`)
  process.exitCode = 1
} finally {
  await closeDatabase()
}
