import { closeDatabase } from '../server/db/client'
import { checkContentExportConsistency } from '../server/services/content-export-consistency'
import { describeCmsFailure } from '../server/utils/cms-sensitive-data'

try {
  const report = await checkContentExportConsistency()
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (report.issueCount) process.exitCode = 1
} catch (error) {
  process.stderr.write(`${describeCmsFailure(error)}\n`)
  process.exitCode = 1
} finally {
  await closeDatabase()
}
