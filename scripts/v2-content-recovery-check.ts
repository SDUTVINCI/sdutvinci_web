import { sql } from 'drizzle-orm'
import { closeDatabase, getDatabase } from '../server/db/client'
import { describeCmsFailure } from '../server/utils/cms-sensitive-data'

try {
  const result = await getDatabase().execute(sql`
    select
      (select count(*) from articles) as articles,
      (select count(*) from article_revisions) as revisions,
      (
        select count(*)
        from articles a
        left join article_revisions r on r.id = a.current_revision_id
        where a.current_revision_id is null
           or r.id is null
           or r.article_id <> a.id
      ) as pointer_issues,
      (
        select count(*)
        from article_revisions r
        where r.content_hash !~ '^[0-9a-f]{64}$'
      ) as hash_issues
  `)
  const row = result.rows[0] as Record<string, string>
  const report = {
    articles: Number(row.articles),
    revisions: Number(row.revisions),
    pointerIssues: Number(row.pointer_issues),
    hashIssues: Number(row.hash_issues)
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (report.pointerIssues || report.hashIssues || report.articles !== report.revisions) {
    throw new Error('CONTENT_RECOVERY_INTEGRITY_FAILED')
  }
} catch (error) {
  process.stderr.write(`${describeCmsFailure(error)}\n`)
  process.exitCode = 1
} finally {
  await closeDatabase()
}
