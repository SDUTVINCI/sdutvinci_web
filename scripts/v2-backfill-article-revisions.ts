import { closeDatabase } from '../server/db/client'
import {
  applyArticleRevisionBackfill,
  ArticleRevisionBackfillValidationError,
  dryRunArticleRevisionBackfill
} from '../server/services/v2-article-revision-backfill'

const args = process.argv.slice(2)
const knownArgs = new Set([
  '--dry-run',
  '--apply',
  '--confirm=BACKFILL_ARTICLE_REVISIONS'
])
const unknown = args.filter(arg => !knownArgs.has(arg))
const apply = args.includes('--apply')
const dryRun = args.includes('--dry-run') || !apply

if (unknown.length) {
  console.error(`未知参数：${unknown.join(', ')}`)
  process.exitCode = 2
} else if (apply && dryRun) {
  console.error('不能同时使用 --dry-run 和 --apply')
  process.exitCode = 2
} else if (apply && !args.includes('--confirm=BACKFILL_ARTICLE_REVISIONS')) {
  console.error('实际回填必须同时提供 --confirm=BACKFILL_ARTICLE_REVISIONS')
  process.exitCode = 2
} else {
  try {
    const report = apply
      ? await applyArticleRevisionBackfill()
      : await dryRunArticleRevisionBackfill()
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    if (report.summary.blockers) process.exitCode = 2
  } catch (error) {
    if (error instanceof ArticleRevisionBackfillValidationError) {
      process.stdout.write(`${JSON.stringify(error.report, null, 2)}\n`)
      process.exitCode = 2
    } else {
      console.error(
        'Article Revision 回填失败：',
        error instanceof Error ? error.message : String(error)
      )
      process.exitCode = 1
    }
  } finally {
    await closeDatabase()
  }
}
