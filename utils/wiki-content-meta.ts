import { pinyin } from 'pinyin-pro'

const WIKI_STEM_PREFIX = 'wiki/'

export interface WikiContentMeta {
  path: string
  chapter?: string
  chapterSort: number
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
  const chapter = parseChapter(rawFileName)
  const slugParts = parts.slice(2).map(toPinyinSlug)

  if (slugParts.at(-1) === 'index') {
    slugParts.pop()
  }

  return {
    path: `/${['wiki', docKey, ...slugParts].filter(Boolean).join('/')}`,
    chapter,
    chapterSort: chapter ? chapterToSort(chapter) : 0,
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

function parseChapter(fileName: string) {
  const normalized = stripSortPrefix(fileName)
  const match = normalized.match(/^ch(\d+(?:-\d+)*)/i)

  return match ? match[1].replace(/-/g, '.') : undefined
}

function chapterToSort(chapter: string) {
  const weights = [1000000, 10000, 100, 1]

  return chapter
    .split('.')
    .slice(0, weights.length)
    .reduce((total, part, index) => total + Number(part || 0) * weights[index], 0)
}

function titleFromDocKey(docKey: string) {
  return stripSortPrefix(docKey)
    .replace(/^\d{4}-\d{2}-\d{2}-/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase())
}
