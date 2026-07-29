import { closeDatabase } from '../server/db/client'
import { checkCmsPhase5Consistency } from '../server/services/cms-phase5-consistency'

try {
  const report = await checkCmsPhase5Consistency()
  console.log(JSON.stringify(report, null, 2))
  if (report.issueCount) process.exitCode = 1
} catch (error) {
  console.error(
    '阶段 5 DB-first 一致性检查失败：',
    error instanceof Error ? error.message : error
  )
  process.exitCode = 1
} finally {
  await closeDatabase()
}
