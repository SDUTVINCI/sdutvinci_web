import { createHash, randomUUID } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'
import { sql } from 'drizzle-orm'
import { getDatabase } from '../db/client'
import {
  articles,
  articleRevisions,
  auditLogs,
  contentImportItems,
  contentImportRuns,
  memberRevisions,
  members
} from '../db/schema'
import { describeCmsFailure } from '../utils/cms-sensitive-data'
import { parseCmsMarkdown } from '../utils/cms-frontmatter'
import { getContentRecoveryConfig } from '../utils/content-recovery-config'
import {
  readContentRepositorySnapshot,
  readRepositoryFile
} from './content-export-snapshot'
import {
  contentExportPath,
  serializeContentRevision,
  sha256ContentBytes
} from './content-export-serialization'
import { getCmsArticleDirectory, getCmsArticlePublicPath } from './cms-articles'
import { memberProfileFromMarkdown, profileRecord, serializeMemberProfile, type MemberProfileSnapshot } from './member-profile'

type RecoveryMode = 'empty_database_initialization' | 'disaster_recovery'

interface ValidatedRecoveryItem {
  articleId: string
  revisionId: string
  revisionNumber: number
  collection: 'news' | 'wiki'
  relativePath: string
  path: string
  sha256: string
  source: string
  body: string
  frontmatter: Record<string, unknown>
}

interface ValidatedMember {
  memberId: string
  revisionId: string
  revisionNumber: number
  memberKey: string
  name: string
  sourcePath: string
  source: string
  sha256: string
  profile: MemberProfileSnapshot
}

export interface ContentRecoveryReport {
  formatVersion: 1
  mode: RecoveryMode
  sourceRoot: string
  sourceCommitHash: string | null
  snapshotSha256: string
  manifestSha256: string
  itemCount: number
  tombstoneCount: number
  memberCount: number
  references: string[]
  reportSha256: string
  requiredConfirmation: string
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

const assertRecoveryEnabled = () => {
  const config = getContentRecoveryConfig()
  if (config.CONTENT_RECOVERY_MODE !== 'enabled') {
    throw new Error('CONTENT_RECOVERY_MODE_NOT_ENABLED')
  }
}

const safeSourceRoot = async (requested: string) => {
  if (!isAbsolute(requested)) throw new Error('CONTENT_RECOVERY_ROOT_NOT_ABSOLUTE')
  const root = resolve(requested)
  if (root === '/') throw new Error('CONTENT_RECOVERY_ROOT_TOO_BROAD')
  const stat = await lstat(root)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('CONTENT_RECOVERY_ROOT_UNSAFE')
  }
  return root
}

const walkMarkdown = async (root: string, prefix = ''): Promise<string[]> => {
  const result: string[] = []
  const directory = resolve(root, prefix)
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  })
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    const target = resolve(root, relativePath)
    if (!target.startsWith(`${root}${sep}`)) throw new Error('CONTENT_RECOVERY_PATH_ESCAPE')
    const stat = await lstat(target)
    if (stat.isSymbolicLink()) throw new Error('CONTENT_RECOVERY_SYMLINK')
    if (stat.isDirectory()) result.push(...await walkMarkdown(root, relativePath))
    else if (stat.isFile() && entry.name.endsWith('.md')) result.push(relativePath)
    else if (!stat.isFile()) throw new Error('CONTENT_RECOVERY_SPECIAL_FILE')
  }
  return result.sort()
}

const loadLegacyMembers = async (root: string): Promise<ValidatedMember[]> => {
  const candidates = ['members', 'content/members']
  const membersByKey = new Map<string, ValidatedMember>()
  for (const candidate of candidates) {
    for (const memberPath of await walkMarkdown(root, candidate)) {
      const source = await readRepositoryFile(root, memberPath)
      if (source === null) continue
      const parsed = parseCmsMarkdown(source)
      const key = parsed.frontmatter.id
      const name = parsed.frontmatter.name
      if (typeof key !== 'string' || !key || typeof name !== 'string' || !name) {
        throw new Error(`CONTENT_RECOVERY_MEMBER_INVALID:${memberPath}`)
      }
      if (membersByKey.has(key)) {
        throw new Error(`CONTENT_RECOVERY_MEMBER_DUPLICATE:${key}`)
      }
      membersByKey.set(key, {
        memberId: randomUUID(),
        revisionId: randomUUID(),
        revisionNumber: 1,
        memberKey: key,
        name,
        sourcePath: memberPath.replace(/^content\/members\/|^members\//, ''),
        source,
        sha256: sha256ContentBytes(source),
        profile: memberProfileFromMarkdown(source, memberPath.replace(/^content\/members\/|^members\//, ''), { allowLegacyUnknownFields: true })
      })
    }
  }
  return [...membersByKey.values()].sort((a, b) =>
    a.memberKey.localeCompare(b.memberKey)
  )
}

const loadAndValidate = async (
  sourceRoot: string,
  mode: RecoveryMode
) => {
  const root = await safeSourceRoot(sourceRoot)
  const snapshotSource = await readRepositoryFile(root, '.vinci/snapshot.json')
  const manifestSource = await readRepositoryFile(root, 'manifest.json')
  const snapshot = await readContentRepositorySnapshot(root)
  if (!snapshotSource || !manifestSource || !snapshot) {
    throw new Error('CONTENT_RECOVERY_METADATA_MISSING')
  }
  const manifest = JSON.parse(manifestSource) as {
    formatVersion?: number
    layoutVersion?: number
    serializerVersion?: number
    snapshot?: { path?: string, sha256?: string }
    files?: Array<{ path?: string, sha256?: string, bytes?: number }>
  }
  if (
    manifest.formatVersion !== 1
    || manifest.layoutVersion !== 1
    || manifest.serializerVersion !== 1
    || manifest.snapshot?.path !== '.vinci/snapshot.json'
    || manifest.snapshot.sha256 !== sha256ContentBytes(snapshotSource)
  ) {
    throw new Error('CONTENT_RECOVERY_MANIFEST_INVALID')
  }
  const manifestByPath = new Map(
    (manifest.files || []).map(item => [item.path, item])
  )
  if (manifestByPath.size !== snapshot.files.length + snapshot.members.length) {
    throw new Error('CONTENT_RECOVERY_MANIFEST_FILE_COUNT_MISMATCH')
  }
  const membersToImport: ValidatedMember[] = snapshot.members.length ? [] : await loadLegacyMembers(root)
  for (const file of snapshot.members) {
    const source = await readRepositoryFile(root, file.path)
    if (source === null || sha256ContentBytes(source) !== file.sha256 || Buffer.byteLength(source) !== file.bytes) {
      throw new Error(`CONTENT_RECOVERY_MEMBER_HASH_MISMATCH:${file.path}`)
    }
    const manifestFile = manifestByPath.get(file.path)
    if (manifestFile?.sha256 !== file.sha256 || manifestFile.bytes !== file.bytes) {
      throw new Error(`CONTENT_RECOVERY_MEMBER_MANIFEST_INVALID:${file.path}`)
    }
    const profile = memberProfileFromMarkdown(source, file.sourcePath)
    if (profile.memberKey !== file.memberKey || serializeMemberProfile(profile).source !== source) {
      throw new Error(`CONTENT_RECOVERY_MEMBER_SERIALIZATION_MISMATCH:${file.path}`)
    }
    membersToImport.push({
      memberId: file.memberId, revisionId: file.revisionId, revisionNumber: file.revisionNumber,
      memberKey: file.memberKey, name: profile.name, sourcePath: file.sourcePath,
      source, sha256: file.sha256, profile
    })
  }
  const memberKeys = new Set(membersToImport.map(item => item.memberKey))
  const managedPaths = [
    ...await walkMarkdown(root, 'news'),
    ...await walkMarkdown(root, 'wiki'),
    ...(snapshot.members.length ? await walkMarkdown(root, 'members') : [])
  ]
  const snapshotPaths = new Set([...snapshot.files.map(item => item.path), ...snapshot.members.map(item => item.path)])
  if (
    managedPaths.length !== snapshotPaths.size
    || managedPaths.some(path => !snapshotPaths.has(path))
  ) {
    throw new Error('CONTENT_RECOVERY_MANAGED_FILE_SET_MISMATCH')
  }
  const references = new Set<string>()
  const articleIds = new Set<string>()
  const revisionIds = new Set<string>()
  const paths = new Set<string>()
  const items: ValidatedRecoveryItem[] = []
  for (const file of snapshot.files) {
    if (
      articleIds.has(file.articleId)
      || revisionIds.has(file.revisionId)
      || paths.has(file.path)
      || file.path !== contentExportPath(file.collection, file.relativePath)
    ) {
      throw new Error(`CONTENT_RECOVERY_ID_OR_PATH_DUPLICATE:${file.path}`)
    }
    articleIds.add(file.articleId)
    revisionIds.add(file.revisionId)
    paths.add(file.path)
    const source = await readRepositoryFile(root, file.path)
    if (
      source === null
      || sha256ContentBytes(source) !== file.sha256
      || Buffer.byteLength(source) !== file.bytes
    ) {
      throw new Error(`CONTENT_RECOVERY_FILE_HASH_MISMATCH:${file.path}`)
    }
    const manifestFile = manifestByPath.get(file.path)
    if (
      manifestFile?.sha256 !== file.sha256
      || manifestFile.bytes !== file.bytes
    ) {
      throw new Error(`CONTENT_RECOVERY_MANIFEST_FILE_INVALID:${file.path}`)
    }
    const parsed = parseCmsMarkdown(source)
    if (parsed.frontmatter.vinciId !== file.articleId) {
      throw new Error(`CONTENT_RECOVERY_VINCI_ID_MISMATCH:${file.path}`)
    }
    const frontmatter = { ...parsed.frontmatter }
    delete frontmatter.vinciId
    const roundTrip = serializeContentRevision({
      articleId: file.articleId,
      collection: file.collection,
      relativePath: file.relativePath,
      revisionId: file.revisionId,
      revisionNumber: file.revisionNumber,
      frontmatter,
      body: parsed.body,
      revisionCreatedAt: new Date(snapshot.generatedAt || 0)
    })
    if (roundTrip.source !== source) {
      throw new Error(`CONTENT_RECOVERY_SERIALIZATION_MISMATCH:${file.path}`)
    }
    for (const field of ['authors', 'contributors'] as const) {
      const value = frontmatter[field]
      if (value === undefined) continue
      if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
        throw new Error(`CONTENT_RECOVERY_REFERENCE_FORMAT_INVALID:${file.path}:${field}`)
      }
      for (const item of value as string[]) references.add(item)
    }
    items.push({
      articleId: file.articleId,
      revisionId: file.revisionId,
      revisionNumber: file.revisionNumber,
      collection: file.collection,
      relativePath: file.relativePath,
      path: file.path,
      sha256: file.sha256,
      source,
      body: parsed.body,
      frontmatter
    })
  }
  for (const tombstone of snapshot.tombstones) {
    if (
      articleIds.has(tombstone.articleId)
      || revisionIds.has(tombstone.revisionId)
      || paths.has(tombstone.path)
      || tombstone.path !== contentExportPath(
        tombstone.collection,
        tombstone.relativePath
      )
    ) {
      throw new Error(`CONTENT_RECOVERY_TOMBSTONE_INVALID:${tombstone.path}`)
    }
    articleIds.add(tombstone.articleId)
    revisionIds.add(tombstone.revisionId)
    paths.add(tombstone.path)
  }
  for (const reference of references) {
    if (!memberKeys.has(reference)) {
      throw new Error(`CONTENT_RECOVERY_REFERENCE_MISSING:${reference}`)
    }
  }
  const sourceCommitFile = await readRepositoryFile(root, '.vinci/source-commit')
  const sourceCommitHash = sourceCommitFile?.trim() || null
  if (sourceCommitHash && !/^[0-9a-f]{40}$/.test(sourceCommitHash)) {
    throw new Error('CONTENT_RECOVERY_SOURCE_COMMIT_INVALID')
  }
  const base = {
    formatVersion: 1 as const,
    mode,
    sourceRoot: root,
    sourceCommitHash,
    snapshotSha256: sha256ContentBytes(snapshotSource),
    manifestSha256: sha256ContentBytes(manifestSource),
    itemCount: items.length,
    tombstoneCount: snapshot.tombstones.length,
    memberCount: membersToImport.length,
    references: [...references].sort()
  }
  const reportSha256 = sha256(`${JSON.stringify(base, null, 2)}\n`)
  const requiredConfirmation =
    `INITIALIZE:${mode}:${base.snapshotSha256}:${reportSha256}:${items.length}`
  return {
    root,
    snapshot,
    items,
    members: membersToImport,
    report: { ...base, reportSha256, requiredConfirmation }
  }
}

const assertEmptyDatabase = async (tx = getDatabase()) => {
  const result = await tx.execute(sql`
    select
      (select count(*) from users)
      + (select count(*) from members)
      + (select count(*) from articles)
      + (select count(*) from article_revisions)
      + (select count(*) from member_revisions)
      + (select count(*) from member_proposals)
      + (select count(*) from drafts)
      + (select count(*) from review_events)
      + (select count(*) from publish_records)
      + (select count(*) from media_assets)
      + (select count(*) from article_deletion_events)
      + (select count(*) from content_export_jobs)
      + (select count(*) from content_export_runs)
      + (select count(*) from content_reconciliation_runs)
      + (select count(*) from content_import_runs)
      + (select count(*) from content_import_items)
      + (select count(*) from edit_locks)
      + (select count(*) from user_members)
      + (select count(*) from user_roles)
      + (select count(*) from draft_authors)
      + (select count(*) from sessions)
      + (select count(*) from rate_limit_buckets)
      + (select count(*) from audit_logs) as count
  `)
  const count = Number((result.rows[0] as { count: string | number }).count)
  if (count !== 0) throw new Error(`CONTENT_RECOVERY_DATABASE_NOT_EMPTY:${count}`)
}

export const dryRunContentRecovery = async (
  sourceRoot: string,
  mode: RecoveryMode,
  actorLabel: string
): Promise<ContentRecoveryReport> => {
  assertRecoveryEnabled()
  if (!actorLabel.trim()) throw new Error('CONTENT_RECOVERY_ACTOR_REQUIRED')
  await assertEmptyDatabase()
  return (await loadAndValidate(sourceRoot, mode)).report
}

export const applyContentRecovery = async (
  sourceRoot: string,
  mode: RecoveryMode,
  actorLabel: string,
  confirmation: string
) => {
  assertRecoveryEnabled()
  const validated = await loadAndValidate(sourceRoot, mode)
  if (confirmation !== validated.report.requiredConfirmation) {
    throw new Error('CONTENT_RECOVERY_CONFIRMATION_INVALID')
  }
  const runId = randomUUID()
  try {
    await getDatabase().transaction(async (tx) => {
      await assertEmptyDatabase(tx)
      await tx.insert(contentImportRuns).values({
        id: runId,
        mode,
        status: 'dry_run',
        sourceCommitHash: validated.report.sourceCommitHash,
        snapshotSha256: validated.report.snapshotSha256,
        confirmationHash: sha256(confirmation),
        actorLabel: actorLabel.trim(),
        itemCount: validated.items.length,
        report: JSON.parse(JSON.stringify(validated.report)) as Record<string, unknown>
      })
      if (validated.members.length) {
        await tx.insert(members).values(validated.members.map(item => ({
          id: item.memberId,
          memberKey: item.memberKey,
          name: item.name,
          sourcePath: item.sourcePath,
          avatarUrl: item.profile.avatarUrl,
          role: item.profile.role,
          memberType: item.profile.memberType,
          seasons: item.profile.seasons,
          advisorSeasons: item.profile.advisorSeasons,
          grade: item.profile.grade,
          affiliation: item.profile.affiliation,
          links: item.profile.links,
          body: item.profile.body,
          sortOrder: item.profile.sortOrder,
          metadata: item.profile.metadata
        })))
        await tx.insert(memberRevisions).values(validated.members.map(item => ({
          id: item.revisionId, memberId: item.memberId, revisionNumber: item.revisionNumber,
          memberKey: item.memberKey, sourcePath: item.sourcePath, profile: profileRecord(item.profile),
          markdownSource: item.source, contentHash: item.sha256, sourceKind: 'backfill' as const,
          createdAt: new Date(validated.snapshot.generatedAt || Date.now())
        })))
        for (const item of validated.members) await tx.execute(sql`
          update members set current_revision_id = ${item.revisionId}::uuid where id = ${item.memberId}::uuid
        `)
      }
      for (const [index, item] of validated.items.entries()) {
        const title = item.frontmatter.title
        if (typeof title !== 'string' || !title.trim()) {
          throw new Error(`CONTENT_RECOVERY_TITLE_INVALID:${item.path}`)
        }
        await tx.insert(articles).values({
          id: item.articleId,
          collection: item.collection,
          relativePath: item.relativePath,
          publicPath: getCmsArticlePublicPath(item.collection, item.relativePath),
          directory: getCmsArticleDirectory(item.collection, item.relativePath),
          title,
          frontmatter: item.frontmatter,
          searchText: `${title}\n${item.body}`.toLowerCase(),
          contentHash: item.sha256,
          currentRevisionId: null,
          isPresent: 'true',
          scannedAt: new Date()
        })
        await tx.insert(articleRevisions).values({
          id: item.revisionId,
          articleId: item.articleId,
          revisionNumber: item.revisionNumber,
          markdownSource: item.source,
          body: item.body,
          frontmatter: item.frontmatter,
          contentHash: item.sha256,
          sourceKind: 'backfill',
          createdAt: new Date(validated.snapshot.generatedAt || Date.now())
        })
        await tx.execute(sql`
          update articles
          set current_revision_id = ${item.revisionId}::uuid,
              updated_at = now()
          where id = ${item.articleId}::uuid
        `)
        await tx.insert(contentImportItems).values({
          runId,
          articleId: item.articleId,
          revisionId: item.revisionId,
          collection: item.collection,
          relativePath: item.relativePath,
          sha256: item.sha256,
          status: 'imported'
        })
        if (
          process.env.NODE_ENV === 'test'
          && process.env.CONTENT_RECOVERY_TEST_FAIL_AFTER_ITEMS === String(index + 1)
        ) {
          throw new Error('CONTENT_RECOVERY_INJECTED_TRANSACTION_FAILURE')
        }
      }
      await tx.insert(auditLogs).values({
        actorUserId: null,
        action: 'content_recovery.initialize',
        targetType: 'content_import_run',
        targetId: runId,
        metadata: {
          mode,
          actorLabel: actorLabel.trim(),
          snapshotSha256: validated.report.snapshotSha256,
          reportSha256: validated.report.reportSha256,
          itemCount: validated.items.length
        }
      })
      await tx.execute(sql`
        update content_import_runs
        set status = 'succeeded', completed_at = now()
        where id = ${runId}::uuid
      `)
    })
    return { runId, status: 'succeeded' as const, report: validated.report }
  } catch (error) {
    // The run row is deliberately transactional. A failed import leaves no
    // partial articles, revisions, members, audit rows, or misleading success.
    throw new Error(describeCmsFailure(error, 1000))
  }
}
