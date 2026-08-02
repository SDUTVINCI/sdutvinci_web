import { createHash } from 'node:crypto'
import {
  HeadBucketCommand,
  HeadObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import { sql } from 'drizzle-orm'
import { getDatabase } from '../db/client'
import { mediaAssets } from '../db/schema'
import { getCmsMediaConfig } from '../utils/cms-media-config'

interface StorageDoctorClient {
  send(command: HeadBucketCommand | HeadObjectCommand): Promise<unknown>
}

export interface OperationsDoctorReport {
  database: {
    articlePointerIssues: number
    memberPointerIssues: number
    pendingExportJobs: number
    failedExportJobs: number
    latestReconciliationStatus: string | null
    pendingPrImports: number
  }
  storage: {
    bucketReachable: boolean
    metadataCount: number
    checkedObjectCount: number
    missingObjectCount: number
    publicUrlMismatchCount: number
    missingObjectKeyHashes: string[]
  }
  issueCount: number
}

const numberValue = (value: unknown) => Number(value || 0)

const objectKeyHash = (value: string) =>
  createHash('sha256').update(value).digest('hex').slice(0, 16)

const expectedPublicUrl = (base: string, key: string) =>
  `${base.replace(/\/+$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`

export const runOperationsDoctor = async (
  storageClient?: StorageDoctorClient
): Promise<OperationsDoctorReport> => {
  const databaseResult = await getDatabase().execute(sql`
    select
      (
        select count(*) from articles a
        left join article_revisions r on r.id = a.current_revision_id
        where a.deleted_at is null and (
          a.current_revision_id is null or r.id is null or r.article_id <> a.id
        )
      ) as article_pointer_issues,
      (
        select count(*) from members m
        left join member_revisions r on r.id = m.current_revision_id
        where m.deleted_at is null and (
          m.current_revision_id is null or r.id is null or r.member_id <> m.id
        )
      ) as member_pointer_issues,
      (select count(*) from content_export_jobs where status in ('pending', 'processing'))
        as pending_export_jobs,
      (select count(*) from content_export_jobs where status = 'failed')
        as failed_export_jobs,
      (select status from content_reconciliation_runs order by started_at desc limit 1)
        as latest_reconciliation_status,
      (select count(*) from content_pr_import_runs where status in ('dry_run', 'processing'))
        as pending_pr_imports
  `)
  const row = databaseResult.rows[0] as Record<string, unknown>
  const database = {
    articlePointerIssues: numberValue(row.article_pointer_issues),
    memberPointerIssues: numberValue(row.member_pointer_issues),
    pendingExportJobs: numberValue(row.pending_export_jobs),
    failedExportJobs: numberValue(row.failed_export_jobs),
    latestReconciliationStatus: row.latest_reconciliation_status
      ? String(row.latest_reconciliation_status)
      : null,
    pendingPrImports: numberValue(row.pending_pr_imports)
  }

  const config = getCmsMediaConfig()
  const client = storageClient || new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY
    }
  })
  await client.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET }))
  const assets = await getDatabase().select({
    objectKey: mediaAssets.objectKey,
    publicUrl: mediaAssets.publicUrl
  }).from(mediaAssets)
  const maximum = Number(process.env.S3_DOCTOR_MAX_OBJECTS || 10000)
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 100000) {
    throw new Error('S3_DOCTOR_MAX_OBJECTS_INVALID')
  }
  if (assets.length > maximum) throw new Error('S3_DOCTOR_OBJECT_LIMIT_EXCEEDED')

  const missingObjectKeyHashes: string[] = []
  let publicUrlMismatchCount = 0
  for (const asset of assets) {
    if (asset.publicUrl !== expectedPublicUrl(config.S3_PUBLIC_BASE_URL, asset.objectKey)) {
      publicUrlMismatchCount += 1
    }
    try {
      await client.send(new HeadObjectCommand({
        Bucket: config.S3_BUCKET,
        Key: asset.objectKey
      }))
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        ?.$metadata?.httpStatusCode
      if (status === 404) {
        missingObjectKeyHashes.push(objectKeyHash(asset.objectKey))
      } else {
        throw new Error('S3_DOCTOR_HEAD_OBJECT_FAILED')
      }
    }
  }

  const storage = {
    bucketReachable: true,
    metadataCount: assets.length,
    checkedObjectCount: assets.length,
    missingObjectCount: missingObjectKeyHashes.length,
    publicUrlMismatchCount,
    missingObjectKeyHashes
  }
  const issueCount = database.articlePointerIssues
    + database.memberPointerIssues
    + database.failedExportJobs
    + storage.missingObjectCount
    + storage.publicUrlMismatchCount
  return { database, storage, issueCount }
}
