import type {
  PublicContentCacheInvalidationInput,
  PublicContentCacheInvalidationResult,
  PublicArticleCollection
} from '../../shared/types/public-content'

interface PublicContentCacheEntry {
  value: unknown
  collection: PublicArticleCollection
  articleId: string
  revisionId: string
  expiresAt: number
}

const maxEntries = 512
const ttlMilliseconds = 5 * 60 * 1000
const cache = new Map<string, PublicContentCacheEntry>()

export const createPublicRevisionCacheKey = (
  collection: PublicArticleCollection,
  articleId: string,
  revisionId: string
) => `phase4:${collection}:${articleId}:revision:${revisionId}`

const pruneExpiredEntries = (now = Date.now()) => {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key)
  }
}

const trimOldestEntries = () => {
  while (cache.size > maxEntries) {
    const oldest = cache.keys().next().value
    if (!oldest) return
    cache.delete(oldest)
  }
}

export const getCachedPublicRevision = <T>(key: string): T | null => {
  const entry = cache.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key)
    return null
  }

  cache.delete(key)
  cache.set(key, entry)
  return entry.value as T
}

export const setCachedPublicRevision = <T>(
  key: string,
  value: T,
  dependency: {
    collection: PublicArticleCollection
    articleId: string
    revisionId: string
  }
) => {
  pruneExpiredEntries()
  cache.delete(key)
  cache.set(key, {
    value,
    ...dependency,
    expiresAt: Date.now() + ttlMilliseconds
  })
  trimOldestEntries()
  return value
}

export const invalidatePublicContentCache = (
  input: PublicContentCacheInvalidationInput = {}
): PublicContentCacheInvalidationResult => {
  pruneExpiredEntries()
  let removed = 0
  for (const [key, entry] of cache) {
    if (input.collection && entry.collection !== input.collection) continue
    if (input.articleId && entry.articleId !== input.articleId) continue
    if (input.revisionId && entry.revisionId !== input.revisionId) continue
    cache.delete(key)
    removed += 1
  }
  return { removed, remaining: cache.size }
}

export const getPublicContentCacheStats = () => {
  pruneExpiredEntries()
  return { entries: cache.size, maxEntries, ttlMilliseconds }
}
