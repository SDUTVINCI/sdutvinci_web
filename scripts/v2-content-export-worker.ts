import { setTimeout as delay } from 'node:timers/promises'
import { closeDatabase } from '../server/db/client'
import { runContentExportWorkerOnce } from '../server/services/content-export-worker'
import { getContentExportConfig } from '../server/utils/content-export-config'
import { describeCmsFailure } from '../server/utils/cms-sensitive-data'
import { runNextRequestedContentReconciliation } from '../server/services/content-reconciliation-requests'

const once = process.argv.includes('--once')
let stopping = false
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopping = true
  })
}

try {
  do {
    const reconciliation = await runNextRequestedContentReconciliation()
    if (reconciliation) process.stdout.write(`${JSON.stringify(reconciliation)}\n`)
    const result = await runContentExportWorkerOnce()
    process.stdout.write(`${JSON.stringify(result)}\n`)
    if (once || stopping) break
    await delay(getContentExportConfig().CONTENT_EXPORT_POLL_SECONDS * 1000)
  } while (!stopping)
} catch (error) {
  process.stderr.write(`${describeCmsFailure(error)}\n`)
  process.exitCode = 1
} finally {
  await closeDatabase()
}
