import { closeDatabase } from '../server/db/client'
import { runMigrations } from '../server/db/migrate'
import { applyCmsMemberMarkdownMigration, planCmsMemberMarkdownMigration } from '../server/services/cms-members'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const known = new Set(['--dry-run', '--apply', '--confirm=MIGRATE_MEMBER_PROFILES'])
const unknown = args.filter(arg => !known.has(arg))

try {
  if (unknown.length) throw new Error(`未知参数：${unknown.join(', ')}`)
  if (apply && args.includes('--dry-run')) throw new Error('不能同时使用 --dry-run 和 --apply')
  if (apply && !args.includes('--confirm=MIGRATE_MEMBER_PROFILES')) {
    throw new Error('实际迁移必须提供 --apply --confirm=MIGRATE_MEMBER_PROFILES')
  }
  await runMigrations()
  const report = apply
    ? { mode: 'apply', ...(await applyCmsMemberMarkdownMigration()) }
    : { mode: 'dry-run', ...(await planCmsMemberMarkdownMigration()), scanned: undefined }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (!apply && report.blockers?.length) process.exitCode = 2
} catch (error) {
  console.error('成员资料迁移失败：', error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await closeDatabase()
}
