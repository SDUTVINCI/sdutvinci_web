import { HeadBucketCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, getDatabase } from '../server/db/client'
import { runMigrations } from '../server/db/migrate'
import { drafts, mediaAssets, users } from '../server/db/schema'
import { runOperationsDoctor } from '../server/services/operations-doctor'
import { resetCmsMediaConfigForTests } from '../server/utils/cms-media-config'
import { configureCmsTestDatabase } from './helpers/cms-test-database'

const enabled = configureCmsTestDatabase()
const suite = enabled ? describe : describe.skip

suite('V2 阶段 11 运维 doctor 与 S3/COS 一致性', () => {
  const originalEnvironment = { ...process.env }

  beforeAll(async () => {
    await runMigrations()
  })

  beforeEach(async () => {
    await getDatabase().execute(`
      truncate table rate_limit_buckets, media_assets, content_pr_external_actions,
      content_pr_import_items, content_pr_import_runs, member_proposals,
      content_import_items, content_import_runs, content_reconciliation_runs,
      content_export_jobs, content_export_runs, article_deletion_events,
      publish_records, edit_locks, review_events, audit_logs, sessions,
      draft_authors, member_revisions, article_revisions, drafts, user_members,
      user_roles, articles, members, users restart identity cascade
    `)
    process.env.S3_ENDPOINT = 'http://127.0.0.1:34912'
    process.env.S3_REGION = 'phase11-test'
    process.env.S3_BUCKET = 'phase11-test-bucket'
    process.env.S3_ACCESS_KEY_ID = 'phase11-test-access'
    process.env.S3_SECRET_ACCESS_KEY = 'phase11-test-secret'
    process.env.S3_PUBLIC_BASE_URL = 'http://127.0.0.1:34912/phase11-test-bucket'
    process.env.S3_FORCE_PATH_STYLE = 'true'
    process.env.S3_KEY_PREFIX = 'images-test'
    resetCmsMediaConfigForTests()
  })

  afterAll(async () => {
    process.env = originalEnvironment
    resetCmsMediaConfigForTests()
    await closeDatabase()
  })

  it('检查全部媒体对象并只报告缺失 key 的摘要，不泄露凭据或对象路径', async () => {
    const [user] = await getDatabase().insert(users).values({
      account: 'phase11doctor',
      passwordHash: 'phase11-test-only'
    }).returning({ id: users.id })
    const [draft] = await getDatabase().insert(drafts).values({
      ownerUserId: user!.id,
      collection: 'wiki',
      title: 'Phase 11 doctor test'
    }).returning({ id: drafts.id })
    const existingKey = 'images-test/2026/08/existing.webp'
    const missingKey = 'images-test/2026/08/private-missing-name.webp'
    await getDatabase().insert(mediaAssets).values([
      {
        draftId: draft!.id,
        uploaderUserId: user!.id,
        objectKey: existingKey,
        publicUrl: `http://127.0.0.1:34912/phase11-test-bucket/${existingKey}`,
        originalFilename: 'existing.png',
        originalMimeType: 'image/png',
        originalByteSize: 10,
        width: 1,
        height: 1,
        byteSize: 10
      },
      {
        draftId: draft!.id,
        uploaderUserId: user!.id,
        objectKey: missingKey,
        publicUrl: 'http://127.0.0.1:34912/wrong-test-url.webp',
        originalFilename: 'missing.png',
        originalMimeType: 'image/png',
        originalByteSize: 10,
        width: 1,
        height: 1,
        byteSize: 10
      }
    ])

    const client = {
      async send(command: HeadBucketCommand | HeadObjectCommand) {
        if (command instanceof HeadBucketCommand) return {}
        if (command.input.Key === missingKey) {
          throw { $metadata: { httpStatusCode: 404 } }
        }
        return {}
      }
    }
    const report = await runOperationsDoctor(client)
    expect(report.database.articlePointerIssues).toBe(0)
    expect(report.database.memberPointerIssues).toBe(0)
    expect(report.storage).toMatchObject({
      bucketReachable: true,
      metadataCount: 2,
      checkedObjectCount: 2,
      missingObjectCount: 1,
      publicUrlMismatchCount: 1
    })
    expect(report.issueCount).toBe(2)
    const output = JSON.stringify(report)
    expect(output).not.toContain(missingKey)
    expect(output).not.toContain('phase11-test-secret')
    expect(report.storage.missingObjectKeyHashes[0]).toMatch(/^[0-9a-f]{16}$/)
  })
})
