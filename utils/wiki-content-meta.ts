import { pinyin } from 'pinyin-pro'

const WIKI_STEM_PREFIX = 'wiki/'

export interface WikiContentMeta {
  path: string
  chapterOrder?: string
  chapterDepth: number
  date?: string
  docKey: string
  docRoot: string
  docTitle: string
  isWikiDoc: boolean
  isWikiIndex: boolean
  wikiDepth: number
}

export function getWikiContentMeta(stem?: string): WikiContentMeta | null {
  if (!stem?.startsWith(WIKI_STEM_PREFIX)) {
    return null
  }

  const parts = stem.split('/')

  if (parts.length < 3) {
    return null
  }

  const rawDocKey = parts[1]
  const docKey = toPinyinSlug(rawDocKey)
  const rawFileName = parts.at(-1) || ''
  const isWikiIndex = rawFileName === 'index'
  const chapterOrder = parseChapterOrder(rawFileName)
  const slugParts = parts.slice(2).map(toPinyinSlug)

  if (slugParts.at(-1) === 'index') {
    slugParts.pop()
  }

  return {
    path: `/${['wiki', docKey, ...slugParts].filter(Boolean).join('/')}`,
    chapterOrder,
    chapterDepth: chapterOrder ? chapterOrder.split('-').length - 1 : 0,
    date: parseDate(rawDocKey),
    docKey,
    docRoot: `/wiki/${docKey}`,
    docTitle: titleFromDocKey(rawDocKey),
    isWikiDoc: true,
    isWikiIndex,
    wikiDepth: Math.max(0, parts.length - 2),
  }
}

function parseDate(value: string) {
  return value.match(/^\d{4}-\d{2}-\d{2}/)?.[0]
}

function stripSortPrefix(value: string) {
  return value.replace(/^\d+\./, '')
}

function toPinyinSlug(value: string) {
  const cleanValue = stripSortPrefix(value)
  const converted = pinyin(cleanValue, {
    toneType: 'none',
    type: 'array',
    nonZh: 'consecutive',
  }).join('-')

  return converted
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function parseChapterOrder(fileName: string) {
  const normalized = stripSortPrefix(fileName)
  return normalized.match(/^(\d{4}(?:-\d{4})*)-/)?.[1]
}

function titleFromDocKey(docKey: string) {
  return stripSortPrefix(docKey)
    .replace(/^\d{4}-\d{2}-\d{2}-/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase())
}
