export const WIKI_DOCUMENT_TAGS = [
  '机械组',
  '嵌入式组',
  '软件算法组',
  '运营组',
  '通用资料'
] as const

export const WIKI_UNCATEGORIZED_TAG = '未分类' as const

export type WikiDocumentTag = typeof WIKI_DOCUMENT_TAGS[number]
export type WikiDocumentCategory = WikiDocumentTag | typeof WIKI_UNCATEGORIZED_TAG

const wikiDocumentTagSet = new Set<string>(WIKI_DOCUMENT_TAGS)

export const isWikiDocumentTag = (value: unknown): value is WikiDocumentTag =>
  typeof value === 'string' && wikiDocumentTagSet.has(value)

export const normalizeWikiDocumentTags = (value: unknown): WikiDocumentCategory[] => {
  if (!Array.isArray(value) || !value.length) return [WIKI_UNCATEGORIZED_TAG]

  const unique = new Set<WikiDocumentTag>()
  for (const item of value) {
    if (typeof item !== 'string' || !wikiDocumentTagSet.has(item)) {
      return [WIKI_UNCATEGORIZED_TAG]
    }
    unique.add(item as WikiDocumentTag)
  }

  if (!unique.size) return [WIKI_UNCATEGORIZED_TAG]
  return WIKI_DOCUMENT_TAGS.filter(tag => unique.has(tag))
}

export const wikiDocumentIndexPath = (relativePath: string) => {
  const normalized = relativePath.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
  const segments = normalized.split('/')
  const root = segments[0]
  return root && segments.length > 1 ? `${root}/index.md` : null
}

export const wikiDocumentDirectory = (relativePath: string) =>
  wikiDocumentIndexPath(relativePath)?.slice(0, -'/index.md'.length) || null

export const isWikiDocumentIndexPath = (relativePath: string) =>
  relativePath.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
  === wikiDocumentIndexPath(relativePath)
