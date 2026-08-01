import { lstat, readFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm'
import { z } from 'zod'
import type { CmsArticleCollection } from '../../shared/types/cms-articles'
import { getDatabase } from '../db/client'
import { articleRevisions, articles, memberRevisions, members } from '../db/schema'
import {
  buildContentRepositoryMetadata,
  CONTENT_REPOSITORY_README,
  contentExportPath,
  serializeContentRevision,
  sha256ContentBytes,
  type ContentSnapshotFile,
  type ContentSnapshotMember,
  type ContentSnapshotTombstone,
  type SerializedContentRevision
} from './content-export-serialization'
import { profileFromRecord, serializeMemberProfile } from './member-profile'
import { runContentExportGit } from './content-export-repository'

const snapshotSchema = z.object({
  formatVersion: z.literal(1),
  layoutVersion: z.literal(1),
  serializerVersion: z.literal(1),
  generatedAt: z.string().datetime().nullable(),
  files: z.array(z.object({
    articleId: z.string().uuid(),
    revisionId: z.string().uuid(),
    revisionNumber: z.number().int().positive(),
    collection: z.enum(['news', 'wiki']),
    relativePath: z.string().min(1),
    path: z.string().min(1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    bytes: z.number().int().nonnegative()
  })),
  members: z.array(z.object({
    memberId: z.string().uuid(),
    memberKey: z.string().min(1),
    revisionId: z.string().uuid(),
    revisionNumber: z.number().int().positive(),
    sourcePath: z.string().min(1),
    path: z.string().min(1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    bytes: z.number().int().nonnegative()
  })).default([]),
  tombstones: z.array(z.object({
    articleId: z.string().uuid(),
    revisionId: z.string().uuid(),
    collection: z.enum(['news', 'wiki']),
    relativePath: z.string().min(1),
    path: z.string().min(1)
  }))
}).strict()

export type ParsedContentSnapshot = z.infer<typeof snapshotSchema>

export interface DatabaseContentExportItem {
  articleId: string
  collection: CmsArticleCollection
  relativePath: string
  revisionId: string
  revisionNumber: number
  revisionCreatedAt: Date
  revisionMarkdownSource: string
  deleted: boolean
  serialized: SerializedContentRevision
}

export interface DatabaseContentExportSnapshot {
  items: DatabaseContentExportItem[]
  activeItems: DatabaseContentExportItem[]
  deletedItems: DatabaseContentExportItem[]
  files: ContentSnapshotFile[]
  tombstones: ContentSnapshotTombstone[]
  memberItems: DatabaseMemberExportItem[]
  activeMemberItems: DatabaseMemberExportItem[]
  memberFiles: ContentSnapshotMember[]
  maximumRevisionCreatedAt: Date | null
  metadata: ReturnType<typeof buildContentRepositoryMetadata>
}

export interface DatabaseMemberExportItem {
  memberId: string
  memberKey: string
  revisionId: string
  revisionNumber: number
  revisionCreatedAt: Date
  sourcePath: string
  deleted: boolean
  serialized: SerializedContentRevision
}

export const loadDatabaseContentExportSnapshot = async (
  database = getDatabase()
): Promise<DatabaseContentExportSnapshot> => {
  const rows = await database
    .select({
      articleId: articles.id,
      collection: articles.collection,
      relativePath: articles.relativePath,
      isPresent: articles.isPresent,
      deletedAt: articles.deletedAt,
      revisionId: articleRevisions.id,
      revisionNumber: articleRevisions.revisionNumber,
      markdownSource: articleRevisions.markdownSource,
      body: articleRevisions.body,
      frontmatter: articleRevisions.frontmatter,
      revisionCreatedAt: articleRevisions.createdAt
    })
    .from(articles)
    .innerJoin(
      articleRevisions,
      eq(articles.currentRevisionId, articleRevisions.id)
    )
    .where(and(
      inArray(articles.collection, ['news', 'wiki']),
      isNotNull(articles.currentRevisionId)
    ))
    .orderBy(asc(articles.collection), asc(articles.relativePath))

  const memberRows = await database.select({
    memberId: members.id,
    memberKey: members.memberKey,
    deletedAt: members.deletedAt,
    revisionId: memberRevisions.id,
    revisionNumber: memberRevisions.revisionNumber,
    sourcePath: memberRevisions.sourcePath,
    profile: memberRevisions.profile,
    revisionCreatedAt: memberRevisions.createdAt
  }).from(members).innerJoin(memberRevisions, eq(members.currentRevisionId, memberRevisions.id))
    .where(isNotNull(members.currentRevisionId)).orderBy(asc(members.memberKey))

  const items: DatabaseContentExportItem[] = rows.map((row) => {
    const collection = row.collection as CmsArticleCollection
    return {
      articleId: row.articleId,
      collection,
      relativePath: row.relativePath,
      revisionId: row.revisionId,
      revisionNumber: row.revisionNumber,
      revisionCreatedAt: row.revisionCreatedAt,
      revisionMarkdownSource: row.markdownSource,
      deleted: Boolean(row.deletedAt) || row.isPresent !== 'true',
      serialized: serializeContentRevision({
        articleId: row.articleId,
        collection,
        relativePath: row.relativePath,
        revisionId: row.revisionId,
        revisionNumber: row.revisionNumber,
        frontmatter: row.frontmatter,
        body: row.body,
        revisionCreatedAt: row.revisionCreatedAt
      })
    }
  })
  const activeItems = items.filter(item => !item.deleted)
  const deletedItems = items.filter(item => item.deleted)
  const files: ContentSnapshotFile[] = activeItems.map(item => ({
    articleId: item.articleId,
    revisionId: item.revisionId,
    revisionNumber: item.revisionNumber,
    collection: item.collection,
    relativePath: item.relativePath,
    path: item.serialized.path,
    sha256: item.serialized.sha256,
    bytes: item.serialized.bytes
  }))
  const tombstones: ContentSnapshotTombstone[] = deletedItems.map(item => ({
    articleId: item.articleId,
    revisionId: item.revisionId,
    collection: item.collection,
    relativePath: item.relativePath,
    path: item.serialized.path
  }))
  const memberItems: DatabaseMemberExportItem[] = memberRows.map(row => ({
    memberId: row.memberId,
    memberKey: row.memberKey,
    revisionId: row.revisionId,
    revisionNumber: row.revisionNumber,
    revisionCreatedAt: row.revisionCreatedAt,
    sourcePath: row.sourcePath,
    deleted: Boolean(row.deletedAt),
    serialized: serializeMemberProfile(profileFromRecord(row.profile))
  }))
  const activeMemberItems = memberItems.filter(item => !item.deleted)
  const memberFiles: ContentSnapshotMember[] = activeMemberItems.map(item => ({
    memberId: item.memberId,
    memberKey: item.memberKey,
    revisionId: item.revisionId,
    revisionNumber: item.revisionNumber,
    sourcePath: item.sourcePath,
    path: item.serialized.path,
    sha256: item.serialized.sha256,
    bytes: item.serialized.bytes
  }))
  const maximumRevisionCreatedAt = [...items, ...memberItems].reduce<Date | null>(
    (maximum, item) =>
      !maximum || item.revisionCreatedAt > maximum
        ? item.revisionCreatedAt
        : maximum,
    null
  )
  return {
    items,
    activeItems,
    deletedItems,
    files,
    tombstones,
    memberItems,
    activeMemberItems,
    memberFiles,
    maximumRevisionCreatedAt,
    metadata: buildContentRepositoryMetadata(
      files,
      tombstones,
      maximumRevisionCreatedAt,
      memberFiles
    )
  }
}

const safeRepositoryPath = (workspace: string, gitPath: string) => {
  const target = resolve(workspace, gitPath)
  if (target !== workspace && !target.startsWith(`${workspace}${sep}`)) {
    throw new Error('CONTENT_EXPORT_PATH_OUTSIDE_WORKSPACE')
  }
  return target
}

export const readRepositoryFile = async (
  workspace: string,
  gitPath: string
) => {
  const target = safeRepositoryPath(workspace, gitPath)
  try {
    const stat = await lstat(target)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error('CONTENT_EXPORT_REPOSITORY_FILE_UNSAFE')
    }
    return await readFile(target, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export const readContentRepositorySnapshot = async (
  workspace: string
): Promise<ParsedContentSnapshot | null> => {
  const source = await readRepositoryFile(workspace, '.vinci/snapshot.json')
  if (source === null) return null
  return snapshotSchema.parse(JSON.parse(source))
}

export type ContentTakeoverAction =
  | 'write'
  | 'move_and_update'
  | 'update'
  | 'delete'
  | 'remove_legacy'
  | 'noop'

export interface ContentTakeoverPlanItem {
  articleId: string
  revisionId: string
  action: ContentTakeoverAction
  sourcePath: string | null
  targetPath: string
  repositorySha256: string | null
  databaseSha256: string | null
  legacyMatchesRevisionBytes: boolean | null
}

export interface ContentTakeoverReport {
  repositoryId: string
  branch: 'main'
  baseCommit: string
  clean: boolean
  trackedFileCount: number
  databaseFileCount: number
  databaseDeletedCount: number
  actions: ContentTakeoverPlanItem[]
  preservedFiles: string[]
  conflicts: string[]
  metadata: {
    snapshotSha256: string
    manifestSha256: string
    readmeSha256: string
  }
  reportSha256: string
}

const reportHash = (value: Omit<ContentTakeoverReport, 'reportSha256'>) =>
  sha256ContentBytes(`${JSON.stringify(value, null, 2)}\n`)

export const buildContentTakeoverReport = async (
  workspace: string,
  snapshot: DatabaseContentExportSnapshot
): Promise<ContentTakeoverReport> => {
  const [baseCommit, branch, dirty, trackedOutput] = await Promise.all([
    runContentExportGit(['rev-parse', 'HEAD'], workspace),
    runContentExportGit(['branch', '--show-current'], workspace),
    runContentExportGit(['status', '--porcelain=v1'], workspace),
    runContentExportGit(['ls-files', '-z'], workspace)
  ])
  if (branch !== 'main') throw new Error('CONTENT_EXPORT_BRANCH_INVALID')
  const tracked = trackedOutput ? trackedOutput.split('\0').filter(Boolean).sort() : []
  const recognized = new Set<string>()
  const actions: ContentTakeoverPlanItem[] = []
  const conflicts: string[] = []

  for (const item of snapshot.activeItems) {
    const targetPath = item.serialized.path
    const legacyPath = `content/${targetPath}`
    recognized.add(targetPath)
    recognized.add(legacyPath)
    const [targetSource, legacySource] = await Promise.all([
      readRepositoryFile(workspace, targetPath),
      readRepositoryFile(workspace, legacyPath)
    ])
    if (targetSource !== null && legacySource !== null) {
      conflicts.push(`${targetPath}: target and legacy paths both exist`)
      continue
    }
    const repositorySource = targetSource ?? legacySource
    const repositorySha256 = repositorySource === null
      ? null
      : sha256ContentBytes(repositorySource)
    const action: ContentTakeoverAction =
      targetSource === item.serialized.source
        ? legacySource === null ? 'noop' : 'remove_legacy'
        : legacySource !== null
          ? 'move_and_update'
          : targetSource !== null
            ? 'update'
            : 'write'
    actions.push({
      articleId: item.articleId,
      revisionId: item.revisionId,
      action,
      sourcePath: legacySource !== null ? legacyPath : null,
      targetPath,
      repositorySha256,
      databaseSha256: item.serialized.sha256,
      legacyMatchesRevisionBytes: legacySource === null
        ? null
        : legacySource === item.revisionMarkdownSource
    })
  }

  for (const item of snapshot.activeMemberItems) {
    const targetPath = item.serialized.path
    const legacyPath = `content/${targetPath}`
    recognized.add(targetPath)
    recognized.add(legacyPath)
    const [targetSource, legacySource] = await Promise.all([
      readRepositoryFile(workspace, targetPath), readRepositoryFile(workspace, legacyPath)
    ])
    if (targetSource !== null && legacySource !== null) {
      conflicts.push(`${targetPath}: target and legacy paths both exist`)
      continue
    }
    const repositorySource = targetSource ?? legacySource
    actions.push({
      articleId: item.memberId,
      revisionId: item.revisionId,
      action: targetSource === item.serialized.source
        ? legacySource === null ? 'noop' : 'remove_legacy'
        : legacySource !== null ? 'move_and_update' : targetSource !== null ? 'update' : 'write',
      sourcePath: legacySource !== null ? legacyPath : null,
      targetPath,
      repositorySha256: repositorySource === null ? null : sha256ContentBytes(repositorySource),
      databaseSha256: item.serialized.sha256,
      legacyMatchesRevisionBytes: null
    })
  }

  for (const item of snapshot.memberItems.filter(item => item.deleted)) {
    for (const path of [item.serialized.path, `content/${item.serialized.path}`]) {
      recognized.add(path)
      const source = await readRepositoryFile(workspace, path)
      if (source !== null) actions.push({
        articleId: item.memberId, revisionId: item.revisionId, action: 'delete',
        sourcePath: path, targetPath: path, repositorySha256: sha256ContentBytes(source),
        databaseSha256: null, legacyMatchesRevisionBytes: null
      })
    }
  }

  for (const item of snapshot.deletedItems) {
    const targetPath = item.serialized.path
    const legacyPath = `content/${targetPath}`
    recognized.add(targetPath)
    recognized.add(legacyPath)
    for (const path of [targetPath, legacyPath]) {
      const source = await readRepositoryFile(workspace, path)
      if (source !== null) {
        actions.push({
          articleId: item.articleId,
          revisionId: item.revisionId,
          action: 'delete',
          sourcePath: path,
          targetPath: path,
          repositorySha256: sha256ContentBytes(source),
          databaseSha256: null,
          legacyMatchesRevisionBytes: source === item.revisionMarkdownSource
        })
      }
    }
  }

  for (const path of ['.vinci/snapshot.json', 'manifest.json', 'README.md']) {
    recognized.add(path)
  }
  const preservedFiles = tracked.filter(path => !recognized.has(path))
  const withoutHash: Omit<ContentTakeoverReport, 'reportSha256'> = {
    repositoryId: 'SDUTVINCI/sdutvinci_content',
    branch: 'main',
    baseCommit,
    clean: !dirty,
    trackedFileCount: tracked.length,
    databaseFileCount: snapshot.activeItems.length + snapshot.activeMemberItems.length,
    databaseDeletedCount: snapshot.deletedItems.length + snapshot.memberItems.filter(item => item.deleted).length,
    actions,
    preservedFiles,
    conflicts,
    metadata: {
      snapshotSha256: snapshot.metadata.snapshotSha256,
      manifestSha256: snapshot.metadata.manifestSha256,
      readmeSha256: sha256ContentBytes(CONTENT_REPOSITORY_README)
    }
  }
  return {
    ...withoutHash,
    reportSha256: reportHash(withoutHash)
  }
}

export const contentTakeoverConfirmation = (report: ContentTakeoverReport) =>
  `TAKEOVER:${report.baseCommit}:${report.reportSha256}`

export const takeoverMetadataFiles = (
  snapshot: DatabaseContentExportSnapshot
) => [
  {
    path: '.vinci/snapshot.json',
    source: snapshot.metadata.snapshotSource
  },
  {
    path: 'manifest.json',
    source: snapshot.metadata.manifestSource
  },
  {
    path: 'README.md',
    source: CONTENT_REPOSITORY_README
  }
]

export const expectedSnapshotFilePath = (
  collection: CmsArticleCollection,
  relativePath: string
) => join(collection, relativePath).replaceAll('\\', '/')

export { contentExportPath }
