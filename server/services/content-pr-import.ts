import { createHash } from 'node:crypto'
import { dirname, extname } from 'node:path'
import { and, asc, eq, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import type {
  CmsContentImportItem,
  CmsContentImportRun,
  ContentImportClassification
} from '../../shared/types/cms-content-imports'
import type { CmsArticleCollection } from '../../shared/types/cms-articles'
import { getDatabase } from '../db/client'
import {
  articleRedirects,
  articleRevisions,
  articles,
  auditLogs,
  contentPrExternalActions,
  contentPrImportItems,
  contentPrImportRuns,
  draftAuthors,
  drafts,
  members
} from '../db/schema'
import { getCmsArticleDirectory, getCmsArticlePublicPath } from './cms-articles'
import {
  ContentImportGitHubClient,
  ContentImportGitHubError,
  type GitHubPullFile
} from './content-import-github'
import { mergeMarkdownThreeWay } from './content-import-merge'
import { serializeContentRevision, sha256ContentBytes } from './content-export-serialization'
import { parseCmsMarkdown } from '../utils/cms-frontmatter'
import { CONTENT_REPOSITORY_ID } from '../utils/content-export-config'
import { getContentImportConfig } from '../utils/content-import-config'
import { redactCmsSensitiveText } from '../utils/cms-sensitive-data'

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
  tombstones: z.array(z.object({
    articleId: z.string().uuid(),
    revisionId: z.string().uuid(),
    collection: z.enum(['news', 'wiki']),
    relativePath: z.string().min(1),
    path: z.string().min(1)
  }))
}).strict()

type Snapshot = z.infer<typeof snapshotSchema>

export class ContentPrImportError extends Error {
  constructor(public readonly code: string, public readonly status = 422) {
    super(code)
  }
}

export const canUseContentPrImport = (roles: readonly string[]) => {
  const config = getContentImportConfig()
  return roles.includes('admin') || roles.some(role => config.authorizedRoles.includes(role))
}

export const requireContentPrImportEnabled = () => {
  if (getContentImportConfig().CONTENT_PR_IMPORT_MODE !== 'enabled') {
    throw new ContentPrImportError('CONTENT_PR_IMPORT_DISABLED', 404)
  }
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

const parseRepositoryInput = (value: string, pullRequestNumber: number) => {
  const trimmed = value.trim().replace(/\.git$/, '').replace(/\/$/, '')
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) return trimmed
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'https:' || url.hostname !== 'github.com'
      || url.username || url.password || url.search || url.hash) return ''
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts.length === 2) return `${parts[0]}/${parts[1]}`
    if (parts.length === 4 && parts[2] === 'pull'
      && Number(parts[3]) === pullRequestNumber) return `${parts[0]}/${parts[1]}`
    return ''
  } catch {
    return ''
  }
}

interface ManagedPath {
  collection: CmsArticleCollection
  relativePath: string
  path: string
}

const parseManagedPath = (path: string): ManagedPath => {
  if (
    !path
    || path.length > 500
    || path !== path.normalize('NFC')
    || path.startsWith('/')
    || path.includes('\\')
    || path.includes('\0')
    || extname(path) !== '.md'
  ) throw new ContentPrImportError('IMPORT_PATH_INVALID')
  const segments = path.split('/')
  if (
    segments.length < 2
    || !['news', 'wiki'].includes(segments[0]!)
    || segments.some(segment => !segment || segment === '.' || segment === '..' || segment === '.git')
  ) throw new ContentPrImportError('IMPORT_PATH_INVALID')
  const collection = segments.shift() as CmsArticleCollection
  const relativePath = segments.join('/')
  return { collection, relativePath, path: `${collection}/${relativePath}` }
}

const stripCode = (source: string) => source
  .replace(/```[\s\S]*?```/g, '')
  .replace(/~~~[\s\S]*?~~~/g, '')
  .replace(/`[^`\n]*`/g, '')

const syntaxWarnings = (source: string) => {
  const visible = stripCode(source)
  const warnings: string[] = []
  if (/<\/?[A-Za-z][^>\n]*>/.test(visible)) warnings.push('RAW_HTML_OR_VUE')
  if (/<(?:script|style|iframe|object|embed)\b/i.test(visible)
    || /\son[a-z]+\s*=/i.test(visible)
    || /(?:javascript|data)\s*:/i.test(visible)) warnings.push('EXECUTABLE_HTML')
  if (/(^|\n)\s*:{2,}[A-Za-z]/.test(visible)) warnings.push('MDC_OR_VUE')
  if (/\{[%{][\s\S]*?[%}]\}/.test(visible) || /(^|\n)\s*@[A-Za-z][\w-]*\b/.test(visible)) {
    warnings.push('UNKNOWN_EXTENSION_SYNTAX')
  }
  return [...new Set(warnings)]
}

const highRisk = (warnings: string[]) =>
  warnings.some(code => ['RAW_HTML_OR_VUE', 'EXECUTABLE_HTML', 'MDC_OR_VUE'].includes(code))

const unknownRisk = (warnings: string[]) => warnings.includes('UNKNOWN_EXTENSION_SYNTAX')

const editableKeys = new Set(['title', 'description', 'authors', 'vinciId'])
const preservedFrontmatter = (frontmatter: Record<string, unknown>) => Object.fromEntries(
  Object.entries(frontmatter).filter(([key]) => !editableKeys.has(key))
)

interface PlannedItem {
  ordinal: number
  changeType: 'added' | 'modified' | 'renamed' | 'removed' | 'invalid'
  classification: ContentImportClassification
  importable: boolean
  oldPath: string | null
  newPath: string | null
  articleId: string | null
  baseRevisionId: string | null
  currentRevisionId: string | null
  baseSource: string | null
  currentSource: string | null
  proposedSource: string | null
  mergedSource: string | null
  warningCodes: string[]
  conflictDetails: Record<string, unknown>
}

const invalidPlan = (
  ordinal: number,
  file: GitHubPullFile,
  code: string,
  details: Record<string, unknown> = {}
): PlannedItem => ({
  ordinal,
  changeType: 'invalid',
  classification: code.includes('PATH') ? 'path_conflict' : 'invalid_file',
  importable: false,
  oldPath: file.previous_filename || (file.status === 'removed' ? file.filename : null),
  newPath: file.status === 'removed' ? null : file.filename,
  articleId: null,
  baseRevisionId: null,
  currentRevisionId: null,
  baseSource: null,
  currentSource: null,
  proposedSource: null,
  mergedSource: null,
  warningCodes: [code],
  conflictDetails: details
})

const serializeCurrent = (row: {
  articleId: string
  collection: string
  relativePath: string
  revisionId: string
  revisionNumber: number
  frontmatter: Record<string, unknown>
  body: string
  createdAt: Date
}) => serializeContentRevision({
  articleId: row.articleId,
  collection: row.collection as CmsArticleCollection,
  relativePath: row.relativePath,
  revisionId: row.revisionId,
  revisionNumber: row.revisionNumber,
  frontmatter: row.frontmatter,
  body: row.body,
  revisionCreatedAt: row.createdAt
}).source

const currentArticle = async (articleId: string) => {
  const [row] = await getDatabase()
    .select({
      articleId: articles.id,
      collection: articles.collection,
      relativePath: articles.relativePath,
      publicPath: articles.publicPath,
      currentRevisionId: articles.currentRevisionId,
      deletedAt: articles.deletedAt,
      isPresent: articles.isPresent,
      revisionId: articleRevisions.id,
      revisionNumber: articleRevisions.revisionNumber,
      markdownSource: articleRevisions.markdownSource,
      body: articleRevisions.body,
      frontmatter: articleRevisions.frontmatter,
      contentHash: articleRevisions.contentHash,
      createdAt: articleRevisions.createdAt
    })
    .from(articles)
    .innerJoin(articleRevisions, eq(articles.currentRevisionId, articleRevisions.id))
    .where(eq(articles.id, articleId))
    .limit(1)
  return row || null
}

const planFile = async (
  client: ContentImportGitHubClient,
  repositoryId: string,
  baseCommit: string,
  headCommit: string,
  snapshot: Snapshot,
  file: GitHubPullFile,
  ordinal: number
): Promise<PlannedItem> => {
  if (!['added', 'modified', 'removed', 'renamed'].includes(file.status)) {
    return invalidPlan(ordinal, file, 'IMPORT_CHANGE_TYPE_INVALID')
  }
  const config = getContentImportConfig()
  if (file.changes > config.CONTENT_PR_IMPORT_MAX_FILE_BYTES) {
    return invalidPlan(ordinal, file, 'IMPORT_FILE_TOO_LARGE')
  }
  let oldPath: ManagedPath | null = null
  let newPath: ManagedPath | null = null
  try {
    if (file.status !== 'added') oldPath = parseManagedPath(file.previous_filename || file.filename)
    if (file.status !== 'removed') newPath = parseManagedPath(file.filename)
  } catch (error) {
    return invalidPlan(ordinal, file, (error as ContentPrImportError).code || 'IMPORT_PATH_INVALID')
  }
  if (oldPath && newPath && oldPath.collection !== newPath.collection) {
    return invalidPlan(ordinal, file, 'IMPORT_CROSS_COLLECTION_MOVE')
  }
  if (file.status === 'renamed' && oldPath && newPath
    && dirname(oldPath.relativePath) !== dirname(newPath.relativePath)) {
    return invalidPlan(ordinal, file, 'IMPORT_CROSS_DIRECTORY_MOVE')
  }

  let baseSource: string | null = null
  let proposedSource: string | null = null
  try {
    if (oldPath) baseSource = await client.readFile(repositoryId, oldPath.path, baseCommit)
    if (newPath) proposedSource = await client.readFile(repositoryId, newPath.path, headCommit)
  } catch (error) {
    const code = error instanceof ContentImportGitHubError ? error.code : 'IMPORT_FILE_READ_FAILED'
    return invalidPlan(ordinal, file, code)
  }

  if (file.status === 'added') {
    if (!newPath || proposedSource === null) return invalidPlan(ordinal, file, 'IMPORT_NEW_FILE_MISSING')
    let parsed
    try { parsed = parseCmsMarkdown(proposedSource) } catch { return invalidPlan(ordinal, file, 'IMPORT_FRONTMATTER_INVALID') }
    if (parsed.frontmatter.vinciId !== undefined) {
      return invalidPlan(ordinal, file, 'IMPORT_NEW_VINCI_ID_FORBIDDEN')
    }
    if (typeof parsed.frontmatter.title !== 'string' || !parsed.frontmatter.title.trim()) {
      return invalidPlan(ordinal, file, 'IMPORT_TITLE_REQUIRED')
    }
    const [pathConflict] = await getDatabase().select({ id: articles.id }).from(articles)
      .where(and(eq(articles.collection, newPath.collection), eq(articles.relativePath, newPath.relativePath)))
      .limit(1)
    if (pathConflict) return invalidPlan(ordinal, file, 'IMPORT_PATH_CONFLICT')
    const warnings = syntaxWarnings(proposedSource)
    const classification: ContentImportClassification = highRisk(warnings)
      ? 'high_risk_syntax'
      : unknownRisk(warnings) ? 'unknown_syntax' : 'new_article'
    return {
      ordinal,
      changeType: 'added',
      classification,
      importable: classification === 'new_article',
      oldPath: null,
      newPath: newPath.path,
      articleId: null,
      baseRevisionId: null,
      currentRevisionId: null,
      baseSource: null,
      currentSource: null,
      proposedSource,
      mergedSource: proposedSource,
      warningCodes: warnings,
      conflictDetails: {}
    }
  }

  if (!oldPath || baseSource === null) return invalidPlan(ordinal, file, 'IMPORT_BASE_FILE_MISSING')
  const snapshotItem = snapshot.files.find(item => item.path === oldPath!.path)
  if (!snapshotItem || snapshotItem.sha256 !== sha256ContentBytes(baseSource)
    || snapshotItem.bytes !== Buffer.byteLength(baseSource)) {
    return invalidPlan(ordinal, file, 'IMPORT_BASE_SNAPSHOT_MISMATCH')
  }
  let baseParsed
  try { baseParsed = parseCmsMarkdown(baseSource) } catch { return invalidPlan(ordinal, file, 'IMPORT_BASE_FRONTMATTER_INVALID') }
  if (baseParsed.frontmatter.vinciId !== snapshotItem.articleId) {
    return invalidPlan(ordinal, file, 'IMPORT_BASE_VINCI_ID_MISMATCH')
  }
  const current = await currentArticle(snapshotItem.articleId)
  if (!current || current.deletedAt || current.isPresent !== 'true') {
    return invalidPlan(ordinal, file, 'IMPORT_ARTICLE_NOT_CURRENT')
  }
  if (current.collection !== oldPath.collection || current.relativePath !== oldPath.relativePath) {
    return invalidPlan(ordinal, file, 'IMPORT_CURRENT_PATH_CHANGED')
  }
  const [baseRevision] = await getDatabase().select({ id: articleRevisions.id })
    .from(articleRevisions)
    .where(and(
      eq(articleRevisions.id, snapshotItem.revisionId),
      eq(articleRevisions.articleId, snapshotItem.articleId)
    )).limit(1)
  if (!baseRevision) return invalidPlan(ordinal, file, 'IMPORT_BASE_REVISION_UNKNOWN')
  const currentSource = serializeCurrent({ ...current, articleId: current.articleId })
  const baseEqualsCurrent = baseSource === currentSource

  if (file.status === 'removed') {
    return {
      ordinal,
      changeType: 'removed',
      classification: baseEqualsCurrent ? 'deletion_proposal' : 'content_conflict',
      importable: baseEqualsCurrent,
      oldPath: oldPath.path,
      newPath: null,
      articleId: current.articleId,
      baseRevisionId: snapshotItem.revisionId,
      currentRevisionId: current.revisionId,
      baseSource,
      currentSource,
      proposedSource: null,
      mergedSource: null,
      warningCodes: baseEqualsCurrent ? [] : ['CURRENT_CHANGED_SINCE_BASE'],
      conflictDetails: baseEqualsCurrent ? {} : { reason: 'current_revision_changed' }
    }
  }
  if (!newPath || proposedSource === null) return invalidPlan(ordinal, file, 'IMPORT_PROPOSED_FILE_MISSING')
  let proposedParsed
  try { proposedParsed = parseCmsMarkdown(proposedSource) } catch { return invalidPlan(ordinal, file, 'IMPORT_FRONTMATTER_INVALID') }
  if (proposedParsed.frontmatter.vinciId !== snapshotItem.articleId) {
    return invalidPlan(ordinal, file, 'IMPORT_PROPOSED_VINCI_ID_MISMATCH')
  }
  if (typeof proposedParsed.frontmatter.title !== 'string' || !proposedParsed.frontmatter.title.trim()) {
    return invalidPlan(ordinal, file, 'IMPORT_TITLE_REQUIRED')
  }
  if (file.status === 'renamed') {
    const targetPublicPath = getCmsArticlePublicPath(newPath.collection, newPath.relativePath)
    const [pathConflict] = await getDatabase().select({ id: articles.id }).from(articles)
      .where(or(
        and(eq(articles.collection, newPath.collection), eq(articles.relativePath, newPath.relativePath), ne(articles.id, current.articleId)),
        and(eq(articles.publicPath, targetPublicPath), ne(articles.id, current.articleId))
      )!).limit(1)
    const [redirectConflict] = await getDatabase().select({ id: articleRedirects.id })
      .from(articleRedirects).where(eq(articleRedirects.fromPublicPath, targetPublicPath)).limit(1)
    if (pathConflict || redirectConflict) return invalidPlan(ordinal, file, 'IMPORT_PATH_CONFLICT')
  }
  const warnings = syntaxWarnings(proposedSource)
  let referenceCount = 0
  if (file.status === 'renamed') {
    const pattern = `%${current.publicPath.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
    const references = await getDatabase().select({ id: articles.id })
      .from(articles)
      .innerJoin(articleRevisions, eq(articles.currentRevisionId, articleRevisions.id))
      .where(and(ne(articles.id, current.articleId), ilike(articleRevisions.markdownSource, pattern)))
    referenceCount = references.length
    if (referenceCount) warnings.push(`REFERENCES_FOUND:${referenceCount}`)
  }
  if (highRisk(warnings) || unknownRisk(warnings)) {
    return {
      ordinal,
      changeType: file.status as 'modified' | 'renamed',
      classification: highRisk(warnings) ? 'high_risk_syntax' : 'unknown_syntax',
      importable: false,
      oldPath: oldPath.path,
      newPath: newPath.path,
      articleId: current.articleId,
      baseRevisionId: snapshotItem.revisionId,
      currentRevisionId: current.revisionId,
      baseSource,
      currentSource,
      proposedSource,
      mergedSource: null,
      warningCodes: warnings,
      conflictDetails: {}
    }
  }
  const merge = mergeMarkdownThreeWay(baseSource, currentSource, proposedSource)
  const isMove = file.status === 'renamed'
  const classification: ContentImportClassification = merge.merged === null
    ? 'content_conflict'
    : isMove ? 'move_or_rename' : baseEqualsCurrent ? 'safe_change' : 'auto_merge'
  return {
    ordinal,
    changeType: file.status as 'modified' | 'renamed',
    classification,
    importable: merge.merged !== null,
    oldPath: oldPath.path,
    newPath: newPath.path,
    articleId: current.articleId,
    baseRevisionId: snapshotItem.revisionId,
    currentRevisionId: current.revisionId,
    baseSource,
    currentSource,
    proposedSource,
    mergedSource: merge.merged,
    warningCodes: [...new Set([
      ...warnings,
      ...(baseEqualsCurrent ? [] : ['CURRENT_CHANGED_SINCE_BASE'])
    ])],
    conflictDetails: merge.conflicts.length
      ? { conflicts: merge.conflicts }
      : file.status === 'renamed'
        ? {
            referenceCount,
            redirect: {
              from: current.publicPath,
              to: getCmsArticlePublicPath(newPath.collection, newPath.relativePath)
            }
          }
        : {}
  }
}

const itemResponse = (row: typeof contentPrImportItems.$inferSelect): CmsContentImportItem => ({
  id: row.id,
  ordinal: row.ordinal,
  changeType: row.changeType as CmsContentImportItem['changeType'],
  classification: row.classification as ContentImportClassification,
  importable: row.importable,
  oldPath: row.oldPath,
  newPath: row.newPath,
  articleId: row.articleId,
  baseRevisionId: row.baseRevisionId,
  currentRevisionId: row.currentRevisionId,
  proposedArticleId: row.proposedArticleId,
  baseSha256: row.baseSha256,
  currentSha256: row.currentSha256,
  proposedSha256: row.proposedSha256,
  mergedSha256: row.mergedSha256,
  warningCodes: row.warningCodes,
  conflictDetails: row.conflictDetails,
  status: row.status as CmsContentImportItem['status'],
  draftId: row.draftId,
  importedAt: row.importedAt?.toISOString() || null,
  hasBase: row.baseSource !== null,
  hasCurrent: row.currentSource !== null,
  hasProposed: row.proposedSource !== null,
  hasMerged: row.mergedSource !== null
})

export const getContentPrImportRun = async (runId: string): Promise<CmsContentImportRun | null> => {
  const [run] = await getDatabase().select().from(contentPrImportRuns)
    .where(eq(contentPrImportRuns.id, runId)).limit(1)
  if (!run) return null
  const items = await getDatabase().select().from(contentPrImportItems)
    .where(eq(contentPrImportItems.runId, run.id)).orderBy(asc(contentPrImportItems.ordinal))
  const actions = await getDatabase().select().from(contentPrExternalActions)
    .where(eq(contentPrExternalActions.runId, run.id))
    .orderBy(asc(contentPrExternalActions.createdAt))
  return {
    id: run.id,
    repositoryId: run.repositoryId,
    pullRequestNumber: run.pullRequestNumber,
    baseCommitHash: run.baseCommitHash,
    headCommitHash: run.headCommitHash,
    baseSnapshotSha256: run.baseSnapshotSha256,
    prAuthorLabel: run.prAuthorLabel,
    status: run.status as CmsContentImportRun['status'],
    itemCount: run.itemCount,
    importableCount: run.importableCount,
    importedCount: run.importedCount,
    conflictCount: run.conflictCount,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() || null,
    externalActions: actions.map(action => ({
      id: action.id,
      action: action.action as 'comment' | 'close',
      status: action.status as 'processing' | 'succeeded' | 'failed',
      errorCode: action.errorCode,
      createdAt: action.createdAt.toISOString()
    })),
    items: items.map(itemResponse)
  }
}

export const dryRunContentPrImport = async (
  actorUserId: string,
  input: { repository: string, pullRequestNumber: number },
  client = new ContentImportGitHubClient()
) => {
  requireContentPrImportEnabled()
  const repositoryId = parseRepositoryInput(input.repository, input.pullRequestNumber)
  if (repositoryId !== CONTENT_REPOSITORY_ID) {
    throw new ContentPrImportError('IMPORT_REPOSITORY_FORBIDDEN', 403)
  }
  const pull = await client.getPullRequest(repositoryId, input.pullRequestNumber)
  if (pull.number !== input.pullRequestNumber
    || pull.base.repo.full_name !== repositoryId
    || pull.base.ref !== 'main'
    || !/^[0-9a-f]{40}$/.test(pull.base.sha)
    || !/^[0-9a-f]{40}$/.test(pull.head.sha)
    || !pull.head.repo
    || pull.state !== 'open') {
    throw new ContentPrImportError('IMPORT_PULL_REQUEST_INVALID')
  }
  const [existing] = await getDatabase().select({ id: contentPrImportRuns.id })
    .from(contentPrImportRuns).where(and(
      eq(contentPrImportRuns.repositoryId, repositoryId),
      eq(contentPrImportRuns.pullRequestNumber, pull.number),
      eq(contentPrImportRuns.headCommitHash, pull.head.sha)
    )).limit(1)
  if (existing) return getContentPrImportRun(existing.id)

  let snapshotSource: string
  try {
    snapshotSource = await client.readFile(repositoryId, '.vinci/snapshot.json', pull.base.sha)
  } catch {
    throw new ContentPrImportError('IMPORT_BASE_SNAPSHOT_UNAVAILABLE')
  }
  let snapshot: Snapshot
  try { snapshot = snapshotSchema.parse(JSON.parse(snapshotSource)) } catch {
    throw new ContentPrImportError('IMPORT_BASE_SNAPSHOT_INVALID')
  }
  const snapshotPaths = new Set<string>()
  const snapshotIds = new Set<string>()
  for (const item of snapshot.files) {
    const path = parseManagedPath(item.path)
    if (path.collection !== item.collection || path.relativePath !== item.relativePath
      || snapshotPaths.has(item.path) || snapshotIds.has(item.articleId)) {
      throw new ContentPrImportError('IMPORT_BASE_SNAPSHOT_DUPLICATE')
    }
    snapshotPaths.add(item.path)
    snapshotIds.add(item.articleId)
  }
  for (const item of snapshot.tombstones) {
    const path = parseManagedPath(item.path)
    if (path.collection !== item.collection || path.relativePath !== item.relativePath
      || snapshotPaths.has(item.path) || snapshotIds.has(item.articleId)) {
      throw new ContentPrImportError('IMPORT_BASE_SNAPSHOT_DUPLICATE')
    }
    snapshotPaths.add(item.path)
    snapshotIds.add(item.articleId)
  }

  const files = await client.listPullFiles(repositoryId, pull.number)
  if (!files.length || files.length > getContentImportConfig().CONTENT_PR_IMPORT_MAX_FILES) {
    throw new ContentPrImportError('IMPORT_PULL_FILE_COUNT_INVALID')
  }
  const planned: PlannedItem[] = []
  for (const [ordinal, file] of files.entries()) {
    if (['.vinci/snapshot.json', 'manifest.json', 'README.md'].includes(file.filename)
      || file.filename.startsWith('members/')) {
      planned.push(invalidPlan(ordinal, file, 'IMPORT_FILE_OUTSIDE_MANIFEST'))
      continue
    }
    planned.push(await planFile(
      client,
      repositoryId,
      pull.base.sha,
      pull.head.sha,
      snapshot,
      file,
      ordinal
    ))
  }

  const pathOwners = new Map<string, PlannedItem[]>()
  const idOwners = new Map<string, PlannedItem[]>()
  for (const item of planned) {
    if (item.newPath) pathOwners.set(item.newPath, [...(pathOwners.get(item.newPath) || []), item])
    if (item.articleId) idOwners.set(item.articleId, [...(idOwners.get(item.articleId) || []), item])
  }
  for (const owners of [...pathOwners.values(), ...idOwners.values()]) {
    if (owners.length < 2) continue
    for (const item of owners) {
      item.classification = 'path_conflict'
      item.importable = false
      item.warningCodes = [...new Set([...item.warningCodes, 'IMPORT_DUPLICATE_PATH_OR_VINCI_ID'])]
    }
  }

  const now = new Date()
  const run = await getDatabase().transaction(async (tx) => {
    const [created] = await tx.insert(contentPrImportRuns).values({
      repositoryId,
      pullRequestNumber: pull.number,
      baseCommitHash: pull.base.sha,
      headCommitHash: pull.head.sha,
      baseSnapshotSha256: sha256ContentBytes(snapshotSource),
      actorUserId,
      prAuthorLabel: pull.user.login.slice(0, 128),
      status: 'dry_run',
      itemCount: planned.length,
      importableCount: planned.filter(item => item.importable).length,
      conflictCount: planned.filter(item => !item.importable).length,
      report: {
        repositoryId,
        pullRequestNumber: pull.number,
        classifications: Object.fromEntries(
          [...new Set(planned.map(item => item.classification))].map(classification => [
            classification,
            planned.filter(item => item.classification === classification).length
          ])
        )
      },
      startedAt: now,
      completedAt: now
    }).onConflictDoNothing({
      target: [
        contentPrImportRuns.repositoryId,
        contentPrImportRuns.pullRequestNumber,
        contentPrImportRuns.headCommitHash
      ]
    }).returning({ id: contentPrImportRuns.id })
    if (!created) {
      const [concurrent] = await tx.select({ id: contentPrImportRuns.id })
        .from(contentPrImportRuns).where(and(
          eq(contentPrImportRuns.repositoryId, repositoryId),
          eq(contentPrImportRuns.pullRequestNumber, pull.number),
          eq(contentPrImportRuns.headCommitHash, pull.head.sha)
        )).limit(1)
      if (!concurrent) throw new ContentPrImportError('IMPORT_IDEMPOTENCY_FAILED', 409)
      return concurrent
    }
    const inserted = await tx.insert(contentPrImportItems).values(planned.map(item => ({
      runId: created.id,
      ordinal: item.ordinal,
      changeType: item.changeType,
      classification: item.classification,
      importable: item.importable,
      oldPath: item.oldPath,
      newPath: item.newPath,
      articleId: item.articleId,
      baseRevisionId: item.baseRevisionId,
      currentRevisionId: item.currentRevisionId,
      proposedArticleId: item.classification === 'new_article' ? undefined : null,
      baseSource: item.baseSource,
      currentSource: item.currentSource,
      proposedSource: item.proposedSource,
      mergedSource: item.mergedSource,
      baseSha256: item.baseSource === null ? null : sha256(item.baseSource),
      currentSha256: item.currentSource === null ? null : sha256(item.currentSource),
      proposedSha256: item.proposedSource === null ? null : sha256(item.proposedSource),
      mergedSha256: item.mergedSource === null ? null : sha256(item.mergedSource),
      warningCodes: item.warningCodes,
      conflictDetails: item.conflictDetails
    }))).returning({ id: contentPrImportItems.id })
    await tx.insert(auditLogs).values({
      actorUserId,
      action: 'content_pr_import.dry_run',
      targetType: 'content_pr_import_run',
      targetId: created.id,
      metadata: {
        repositoryId,
        pullRequestNumber: pull.number,
        baseCommitHash: pull.base.sha,
        headCommitHash: pull.head.sha,
        itemCount: inserted.length,
        importableCount: planned.filter(item => item.importable).length
      }
    })
    return created
  })
  return getContentPrImportRun(run.id)
}

const draftDataFromSource = (source: string) => {
  const parsed = parseCmsMarkdown(source)
  const title = typeof parsed.frontmatter.title === 'string' ? parsed.frontmatter.title.trim() : ''
  if (!title) throw new ContentPrImportError('IMPORT_TITLE_REQUIRED')
  return {
    title,
    description: typeof parsed.frontmatter.description === 'string'
      ? parsed.frontmatter.description.trim() : '',
    authorKeys: Array.isArray(parsed.frontmatter.authors)
      ? parsed.frontmatter.authors.filter((value): value is string => typeof value === 'string')
      : [],
    body: parsed.body,
    preservedFrontmatter: preservedFrontmatter(parsed.frontmatter)
  }
}

const importOneItem = async (runId: string, itemId: string, actorUserId: string) => {
  return getDatabase().transaction(async (tx) => {
    const [item] = await tx.select().from(contentPrImportItems).where(and(
      eq(contentPrImportItems.id, itemId), eq(contentPrImportItems.runId, runId)
    )).limit(1).for('update')
    if (!item) throw new ContentPrImportError('IMPORT_ITEM_NOT_FOUND', 404)
    if (item.status === 'imported' && item.draftId) return { itemId, draftId: item.draftId, imported: false }
    if (!item.importable || !item.mergedSource && item.classification !== 'deletion_proposal') {
      return { itemId, draftId: null, imported: false, blocked: true }
    }
    let current: Awaited<ReturnType<typeof currentArticle>> = null
    if (item.articleId) {
      const [lockedCurrent] = await tx
        .select({
          articleId: articles.id,
          collection: articles.collection,
          relativePath: articles.relativePath,
          publicPath: articles.publicPath,
          currentRevisionId: articles.currentRevisionId,
          deletedAt: articles.deletedAt,
          isPresent: articles.isPresent,
          revisionId: articleRevisions.id,
          revisionNumber: articleRevisions.revisionNumber,
          markdownSource: articleRevisions.markdownSource,
          body: articleRevisions.body,
          frontmatter: articleRevisions.frontmatter,
          contentHash: articleRevisions.contentHash,
          createdAt: articleRevisions.createdAt
        })
        .from(articles)
        .innerJoin(articleRevisions, eq(articles.currentRevisionId, articleRevisions.id))
        .where(eq(articles.id, item.articleId))
        .limit(1)
        .for('update')
      current = lockedCurrent || null
      if (!current || current.revisionId !== item.currentRevisionId) {
        await tx.update(contentPrImportItems).set({
          status: 'blocked',
          importable: false,
          classification: 'content_conflict',
          warningCodes: [...new Set([...item.warningCodes, 'CURRENT_CHANGED_AFTER_DRY_RUN'])]
        }).where(eq(contentPrImportItems.id, item.id))
        return { itemId, draftId: null, imported: false, blocked: true }
      }
    }
    const source = item.classification === 'deletion_proposal' ? item.currentSource : item.mergedSource
    if (!source) throw new ContentPrImportError('IMPORT_ARTIFACT_MISSING')
    const data = draftDataFromSource(source)
    const collection = (item.newPath || item.oldPath)!.split('/')[0] as CmsArticleCollection
    const relativePath = (item.newPath || item.oldPath)!.split('/').slice(1).join('/')
    const [existingDraft] = item.articleId
      ? await tx.select({ id: drafts.id }).from(drafts).where(and(
          eq(drafts.articleId, item.articleId), eq(drafts.ownerUserId, actorUserId), isNull(drafts.deletedAt)
        )).limit(1)
      : []
    if (existingDraft) {
      await tx.update(contentPrImportItems).set({ status: 'blocked' })
        .where(eq(contentPrImportItems.id, item.id))
      return { itemId, draftId: null, imported: false, blocked: true }
    }
    const [draft] = await tx.insert(drafts).values({
      articleId: item.articleId,
      proposedArticleId: item.articleId ? null : item.proposedArticleId,
      ownerUserId: actorUserId,
      collection,
      title: data.title,
      description: data.description,
      body: data.body,
      preservedFrontmatter: data.preservedFrontmatter,
      baseContentHash: current?.contentHash || null,
      baseRevisionId: current?.revisionId || null,
      proposedAction: item.classification === 'deletion_proposal'
        ? 'delete' : item.classification === 'move_or_rename' ? 'move' : 'edit',
      proposedRelativePath: ['move_or_rename', 'new_article'].includes(item.classification)
        ? relativePath : null
    }).returning({ id: drafts.id })
    if (data.authorKeys.length) {
      const authorRows = await tx.select({ id: members.id, key: members.memberKey }).from(members)
        .where(inArray(members.memberKey, [...new Set(data.authorKeys)]))
      if (authorRows.length !== new Set(data.authorKeys).size) {
        throw new ContentPrImportError('IMPORT_AUTHOR_UNKNOWN')
      }
      const byKey = new Map(authorRows.map(row => [row.key, row.id]))
      await tx.insert(draftAuthors).values(data.authorKeys.map((key, position) => ({
        draftId: draft!.id,
        memberId: byKey.get(key)!,
        position
      })))
    }
    const now = new Date()
    await tx.update(contentPrImportItems).set({
      status: 'imported', draftId: draft!.id, importedAt: now
    }).where(eq(contentPrImportItems.id, item.id))
    await tx.insert(auditLogs).values({
      actorUserId,
      action: 'content_pr_import.item_imported',
      targetType: 'content_pr_import_item',
      targetId: item.id,
      metadata: {
        runId,
        classification: item.classification,
        articleId: item.articleId,
        draftId: draft!.id,
        baseRevisionId: item.baseRevisionId,
        currentRevisionId: item.currentRevisionId,
        proposedSha256: item.proposedSha256,
        mergedSha256: item.mergedSha256
      }
    })
    return { itemId, draftId: draft!.id, imported: true }
  })
}

export const importContentPrItems = async (
  runId: string,
  itemIds: string[],
  actorUserId: string
) => {
  requireContentPrImportEnabled()
  const uniqueIds = [...new Set(itemIds)]
  const results = []
  for (const itemId of uniqueIds) results.push(await importOneItem(runId, itemId, actorUserId))
  const countRows = await getDatabase().select({
    importedCount: sql<number>`count(*) filter (where ${contentPrImportItems.status} = 'imported')::int`
  }).from(contentPrImportItems).where(eq(contentPrImportItems.runId, runId))
  const importedCount = countRows[0]?.importedCount || 0
  const [run] = await getDatabase().select().from(contentPrImportRuns)
    .where(eq(contentPrImportRuns.id, runId)).limit(1)
  if (!run) throw new ContentPrImportError('IMPORT_RUN_NOT_FOUND', 404)
  const status = importedCount === run.importableCount ? 'imported' : 'partially_imported'
  await getDatabase().transaction(async (tx) => {
    await tx.update(contentPrImportRuns).set({ importedCount, status, completedAt: new Date() })
      .where(eq(contentPrImportRuns.id, runId))
    await tx.insert(auditLogs).values({
      actorUserId,
      action: 'content_pr_import.items_selected',
      targetType: 'content_pr_import_run',
      targetId: runId,
      metadata: { selectedCount: uniqueIds.length, importedCount, status }
    })
  })
  return { run: await getContentPrImportRun(runId), results }
}

export const getContentPrImportArtifact = async (runId: string, itemId: string) => {
  const [item] = await getDatabase().select({
    id: contentPrImportItems.id,
    baseSource: contentPrImportItems.baseSource,
    currentSource: contentPrImportItems.currentSource,
    proposedSource: contentPrImportItems.proposedSource,
    mergedSource: contentPrImportItems.mergedSource
  }).from(contentPrImportItems).where(and(
    eq(contentPrImportItems.runId, runId), eq(contentPrImportItems.id, itemId)
  )).limit(1)
  if (!item) return null
  return {
    ...item,
    baseSource: item.baseSource === null ? null : redactCmsSensitiveText(item.baseSource),
    currentSource: item.currentSource === null ? null : redactCmsSensitiveText(item.currentSource),
    proposedSource: item.proposedSource === null ? null : redactCmsSensitiveText(item.proposedSource),
    mergedSource: item.mergedSource === null ? null : redactCmsSensitiveText(item.mergedSource)
  }
}

const externalSummary = (run: NonNullable<Awaited<ReturnType<typeof getContentPrImportRun>>>) => [
  `Vinci CMS 已完成 PR #${run.pullRequestNumber} 的脱敏导入检查。`,
  '',
  `- Head: \`${run.headCommitHash}\``,
  `- 文件：${run.itemCount}`,
  `- 可导入：${run.importableCount}`,
  `- 已创建草稿/提案：${run.importedCount}`,
  `- 冲突或阻止：${run.conflictCount}`,
  '',
  '此评论不代表审核、发布或 Merge；数据库仍是正式内容权威。'
].join('\n')

export const executeContentPrExternalAction = async (
  runId: string,
  actorUserId: string,
  action: 'comment' | 'close',
  client = new ContentImportGitHubClient()
) => {
  requireContentPrImportEnabled()
  if (!getContentImportConfig().CONTENT_PR_IMPORT_GITHUB_TOKEN) {
    throw new ContentPrImportError('IMPORT_GITHUB_WRITE_NOT_CONFIGURED', 409)
  }
  const run = await getContentPrImportRun(runId)
  if (!run) throw new ContentPrImportError('IMPORT_RUN_NOT_FOUND', 404)
  const pull = await client.getPullRequest(run.repositoryId, run.pullRequestNumber)
  if (pull.base.repo.full_name !== run.repositoryId || pull.head.sha !== run.headCommitHash) {
    throw new ContentPrImportError('IMPORT_PULL_REQUEST_CHANGED', 409)
  }
  const [record] = await getDatabase().insert(contentPrExternalActions).values({
    runId,
    actorUserId,
    action,
    status: 'processing'
  }).returning({ id: contentPrExternalActions.id })
  try {
    const response = action === 'comment'
      ? await client.comment(run.repositoryId, run.pullRequestNumber, externalSummary(run))
      : await client.close(run.repositoryId, run.pullRequestNumber)
    await getDatabase().transaction(async (tx) => {
      await tx.update(contentPrExternalActions).set({
        status: 'succeeded',
        externalReference: action === 'comment' && 'id' in response ? String(response.id) : 'closed',
        completedAt: new Date()
      }).where(eq(contentPrExternalActions.id, record!.id))
      await tx.insert(auditLogs).values({
        actorUserId,
        action: `content_pr_import.${action}`,
        targetType: 'content_pr_import_run',
        targetId: runId,
        metadata: { repositoryId: run.repositoryId, pullRequestNumber: run.pullRequestNumber, headCommitHash: run.headCommitHash }
      })
    })
    return { succeeded: true }
  } catch (error) {
    const errorCode = error instanceof ContentImportGitHubError ? error.code : 'GITHUB_WRITE_FAILED'
    await getDatabase().transaction(async (tx) => {
      await tx.update(contentPrExternalActions).set({
        status: 'failed', errorCode, completedAt: new Date()
      }).where(eq(contentPrExternalActions.id, record!.id))
      await tx.insert(auditLogs).values({
        actorUserId,
        action: `content_pr_import.${action}_failed`,
        targetType: 'content_pr_import_run',
        targetId: runId,
        metadata: { errorCode }
      })
    })
    throw error
  }
}
