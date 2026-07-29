import { closeDatabase } from '../server/db/client'
import { compareCmsGitAndRevisions } from '../server/services/cms-revision-consistency'

const articleIdArgument = process.argv
  .slice(2)
  .find(argument => argument.startsWith('--article-id='))
const articleId = articleIdArgument?.slice('--article-id='.length)

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

if (
  process.argv.slice(2).some(argument => !argument.startsWith('--article-id='))
  || (articleId && !uuidPattern.test(articleId))
) {
  console.error('用法：npm run v2:revisions:compare -- [--article-id=<uuid>]')
  process.exitCode = 2
} else {
  try {
    const report = await compareCmsGitAndRevisions(articleId)
    console.log(JSON.stringify(report, null, 2))
    if (report.mismatchCount || report.unmatchedGitCommitCount) {
      process.exitCode = 1
    }
  } catch (error) {
    console.error(
      'Revision 一致性比较失败：',
      error instanceof Error ? error.message : error
    )
    process.exitCode = 1
  } finally {
    await closeDatabase()
  }
}
