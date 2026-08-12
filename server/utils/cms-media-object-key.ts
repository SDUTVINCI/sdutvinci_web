import { createHash } from 'node:crypto'
import type { CmsArticleCollection } from '../../shared/types/cms-articles'

const cmsMediaHashLength = 8
const dateOnlyPattern = /^(\d{4})-(\d{2})-(\d{2})(?=T|-|$)/

export const createCmsMediaContentHash = (data: Uint8Array) =>
  createHash('sha256').update(data).digest('hex')

const validDateParts = (value: unknown) => {
  if (typeof value !== 'string') return null
  const match = value.trim().match(dateOnlyPattern)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() + 1 !== month
    || date.getUTCDate() !== day
  ) return null
  return [match[1]!, match[2]!, match[3]!] as const
}

export const resolveCmsMediaArticleDate = (
  preservedFrontmatter: Record<string, unknown>,
  draftCreatedAt: Date,
  relativePath?: string | null
) => {
  const pathParts = validDateParts(relativePath?.split('/')[0])
  if (pathParts) return pathParts
  for (const value of [
    preservedFrontmatter._vinciPublishedAtOverride,
    preservedFrontmatter.publishedAt
  ]) {
    const parts = validDateParts(value)
    if (parts) return parts
  }
  if (Number.isNaN(draftCreatedAt.getTime())) {
    throw new Error('CMS_MEDIA_ARTICLE_DATE_INVALID')
  }
  return [
    draftCreatedAt.getUTCFullYear().toString().padStart(4, '0'),
    String(draftCreatedAt.getUTCMonth() + 1).padStart(2, '0'),
    String(draftCreatedAt.getUTCDate()).padStart(2, '0')
  ] as const
}

export const createCmsMediaObjectKey = (
  prefix: string,
  collection: CmsArticleCollection,
  articleDate: readonly [string, string, string],
  output: Uint8Array,
  now = new Date()
) => {
  const timestamp = now.getTime()
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new Error('CMS_MEDIA_TIMESTAMP_INVALID')
  }

  const contentHash = createCmsMediaContentHash(output)
  return [
    prefix,
    collection,
    ...articleDate,
    `${timestamp}-${contentHash.slice(0, cmsMediaHashLength)}.webp`
  ].join('/')
}
