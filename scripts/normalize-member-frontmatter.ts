import { closeDatabase } from '../server/db/client'
import {
  applyCurrentMemberFrontmatterNormalization,
  planCurrentMemberFrontmatterNormalization
} from '../server/services/cms-members'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const confirmation = '--confirm=NORMALIZE_MEMBER_FRONTMATTER'

try {
  if (args.some(arg => !['--dry-run', '--apply', confirmation].includes(arg))
    || (apply && args.includes('--dry-run'))
    || (apply && !args.includes(confirmation))) {
    throw new Error('先运行 --dry-run；执行时提供 --apply --confirm=NORMALIZE_MEMBER_FRONTMATTER')
  }
  const report = apply
    ? await applyCurrentMemberFrontmatterNormalization()
    : await planCurrentMemberFrontmatterNormalization()
  process.stdout.write(`${JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...report }, null, 2)}\n`)
} catch (error) {
  console.error('成员 frontmatter 规整失败：', error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await closeDatabase()
}
