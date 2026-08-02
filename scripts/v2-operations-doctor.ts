import { closeDatabase } from '../server/db/client'
import { runOperationsDoctor } from '../server/services/operations-doctor'
import { describeCmsFailure } from '../server/utils/cms-sensitive-data'

try {
  const report = await runOperationsDoctor()
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (report.issueCount) process.exitCode = 1
} catch (error) {
  process.stderr.write(`${describeCmsFailure(error)}\n`)
  process.exitCode = 1
} finally {
  await closeDatabase()
}
