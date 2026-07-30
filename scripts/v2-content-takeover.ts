import { closeDatabase } from '../server/db/client'
import {
  applyContentTakeover,
  runContentTakeoverDryRun
} from '../server/services/content-export-worker'
import { contentTakeoverConfirmation } from '../server/services/content-export-snapshot'
import { describeCmsFailure } from '../server/utils/cms-sensitive-data'

const apply = process.argv.includes('--apply')
const confirmation = process.argv
  .find(argument => argument.startsWith('--confirm='))
  ?.slice('--confirm='.length)

try {
  if (apply) {
    if (!confirmation) throw new Error('CONTENT_EXPORT_TAKEOVER_CONFIRMATION_REQUIRED')
    process.stdout.write(`${JSON.stringify(
      await applyContentTakeover(confirmation),
      null,
      2
    )}\n`)
  } else {
    const report = await runContentTakeoverDryRun()
    process.stdout.write(`${JSON.stringify({
      ...report,
      requiredConfirmation: contentTakeoverConfirmation(report)
    }, null, 2)}\n`)
  }
} catch (error) {
  process.stderr.write(`${describeCmsFailure(error)}\n`)
  process.exitCode = 1
} finally {
  await closeDatabase()
}
