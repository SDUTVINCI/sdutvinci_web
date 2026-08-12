import { createHash } from 'node:crypto'
import { stringify } from 'yaml'
import type { CmsArticleCollection } from '../../shared/types/cms-articles'

export const CONTENT_EXPORT_FORMAT_VERSION = 1
export const CONTENT_EXPORT_LAYOUT_VERSION = 1
export const CONTENT_EXPORT_SERIALIZER_VERSION = 1

const systemFrontmatterOrder = [
  'vinciId',
  'title',
  'description',
  'authors',
  'contributors',
  'publishedAt',
  'updatedAt'
] as const

const collectionFrontmatterOrder: Record<CmsArticleCollection, readonly string[]> = {
  news: ['date', 'author', 'tags', 'image', 'bvid', 'summary'],
  wiki: []
}

const compareCodePoints = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0

const normalizeValue = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(normalizeValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => compareCodePoints(left, right))
        .map(([key, item]) => [key, normalizeValue(item)])
    )
  }
  return value
}

const orderedFrontmatter = (
  articleId: string,
  collection: CmsArticleCollection,
  frontmatter: Record<string, unknown>
) => {
  const source: Record<string, unknown> = {
    ...frontmatter,
    vinciId: articleId
  }
  const knownOrder = [
    ...systemFrontmatterOrder,
    ...collectionFrontmatterOrder[collection]
  ]
  const ordered: Record<string, unknown> = {}
  for (const key of knownOrder) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      ordered[key] = normalizeValue(source[key])
    }
  }
  for (const key of Object.keys(source).sort(compareCodePoints)) {
    if (!Object.prototype.hasOwnProperty.call(ordered, key)) {
      ordered[key] = normalizeValue(source[key])
    }
  }
  return ordered
}

const exactlyOneFinalLf = (value: string) =>
  `${value.replace(/\r\n?/g, '\n').replace(/\n*$/, '')}\n`

export const sha256ContentBytes = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex')

export const contentExportPath = (
  collection: CmsArticleCollection,
  relativePath: string
) => {
  const normalized = relativePath.replaceAll('\\', '/')
  if (
    !normalized
    || normalized.startsWith('/')
    || !normalized.endsWith('.md')
    || normalized.includes('\0')
    || normalized.split('/').some(segment => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error('CONTENT_EXPORT_PATH_INVALID')
  }
  return `${collection}/${normalized}`
}

export interface ContentExportRevisionInput {
  articleId: string
  collection: CmsArticleCollection
  relativePath: string
  revisionId: string
  revisionNumber: number
  frontmatter: Record<string, unknown>
  body: string
  revisionCreatedAt: Date
}

export interface SerializedContentRevision {
  path: string
  source: string
  sha256: string
  bytes: number
}

export const serializeContentRevision = (
  input: ContentExportRevisionInput
): SerializedContentRevision => {
  const yaml = stringify(
    orderedFrontmatter(input.articleId, input.collection, input.frontmatter),
    {
      lineWidth: 0,
      defaultStringType: 'PLAIN',
      defaultKeyType: 'PLAIN'
    }
  ).replace(/\r\n?/g, '\n').trimEnd()
  const source = exactlyOneFinalLf(
    `---\n${yaml}\n---\n${input.body.replace(/\r\n?/g, '\n')}`
  )
  return {
    path: contentExportPath(input.collection, input.relativePath),
    source,
    sha256: sha256ContentBytes(source),
    bytes: Buffer.byteLength(source)
  }
}

export interface ContentSnapshotFile {
  articleId: string
  revisionId: string
  revisionNumber: number
  collection: CmsArticleCollection
  relativePath: string
  path: string
  sha256: string
  bytes: number
}

export interface ContentSnapshotTombstone {
  articleId: string
  revisionId: string
  collection: CmsArticleCollection
  relativePath: string
  path: string
}

export interface ContentSnapshotMember {
  memberId: string
  memberKey: string
  revisionId: string
  revisionNumber: number
  sourcePath: string
  path: string
  sha256: string
  bytes: number
}

export interface ContentSnapshotCreditIdentity {
  creditKey: string
  displayName: string
  memberId: string | null
}

export interface ContentRepositoryMetadata {
  snapshotSource: string
  snapshotSha256: string
  manifestSource: string
  manifestSha256: string
}

const deterministicJson = (value: unknown) =>
  `${JSON.stringify(value, null, 2)}\n`

export const buildContentRepositoryMetadata = (
  files: ContentSnapshotFile[],
  tombstones: ContentSnapshotTombstone[],
  maximumRevisionCreatedAt: Date | null,
  members: ContentSnapshotMember[] = [],
  creditIdentities: ContentSnapshotCreditIdentity[] = []
): ContentRepositoryMetadata => {
  const sortedFiles = [...files].sort((left, right) =>
    compareCodePoints(left.path, right.path)
  )
  const sortedTombstones = [...tombstones].sort((left, right) =>
    compareCodePoints(left.articleId, right.articleId)
  )
  const sortedMembers = [...members].sort((left, right) => compareCodePoints(left.path, right.path))
  const sortedCreditIdentities = [...creditIdentities].sort((left, right) =>
    compareCodePoints(left.creditKey, right.creditKey)
  )
  const generatedAt = maximumRevisionCreatedAt?.toISOString() || null
  const snapshotSource = deterministicJson({
    formatVersion: CONTENT_EXPORT_FORMAT_VERSION,
    layoutVersion: CONTENT_EXPORT_LAYOUT_VERSION,
    serializerVersion: CONTENT_EXPORT_SERIALIZER_VERSION,
    generatedAt,
    files: sortedFiles.map(file => ({
      articleId: file.articleId,
      revisionId: file.revisionId,
      revisionNumber: file.revisionNumber,
      collection: file.collection,
      relativePath: file.relativePath,
      path: file.path,
      sha256: file.sha256,
      bytes: file.bytes
    })),
    members: sortedMembers,
    creditIdentities: sortedCreditIdentities,
    tombstones: sortedTombstones
  })
  const snapshotSha256 = sha256ContentBytes(snapshotSource)
  const manifestSource = deterministicJson({
    formatVersion: CONTENT_EXPORT_FORMAT_VERSION,
    layoutVersion: CONTENT_EXPORT_LAYOUT_VERSION,
    serializerVersion: CONTENT_EXPORT_SERIALIZER_VERSION,
    generatedAt,
    snapshot: {
      path: '.vinci/snapshot.json',
      sha256: snapshotSha256
    },
    files: [...sortedFiles, ...sortedMembers].sort((left, right) => compareCodePoints(left.path, right.path)).map(file => ({
      path: file.path,
      sha256: file.sha256,
      bytes: file.bytes
    }))
  })
  return {
    snapshotSource,
    snapshotSha256,
    manifestSource,
    manifestSha256: sha256ContentBytes(manifestSource)
  }
}

export const CONTENT_REPOSITORY_README = `# Vinci Content Snapshot

This repository is a human-readable, one-way snapshot exported from the Vinci
PostgreSQL content authority.

- The \`main\` branch is written only by the database export worker.
- Do not merge proposal branches into \`main\` as a publishing mechanism.
- Local changes belong on \`proposal/*\` branches and are not live content.
- GitHub or export failures never roll back an already published database revision.
- \`.vinci/snapshot.json\` and \`manifest.json\` describe exported revisions,
  article-credit display identities, and hashes.

The website does not read this repository at runtime.
`
