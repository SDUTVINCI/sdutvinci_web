export interface WikiChapterEntry {
  chapterOrder?: string
  title?: string
}

export interface NumberedWikiChapter {
  chapter?: string
  chapterDepth: number
}

export function parseWikiChapterOrder(value: unknown): number[] {
  const order = String(value || '').trim()

  if (!/^\d{4}(?:-\d{4})*$/.test(order)) {
    return []
  }

  return order.split('-').map(part => Number(part))
}

export function compareWikiChapters(
  a: WikiChapterEntry,
  b: WikiChapterEntry
): number {
  const aParts = parseWikiChapterOrder(a.chapterOrder)
  const bParts = parseWikiChapterOrder(b.chapterOrder)
  const length = Math.max(aParts.length, bParts.length)

  for (let index = 0; index < length; index += 1) {
    const aPart = aParts[index]
    const bPart = bParts[index]

    if (aPart === undefined) return -1
    if (bPart === undefined) return 1

    const difference = aPart - bPart
    if (difference) return difference
  }

  return String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN')
}

export function numberWikiChapters<T extends WikiChapterEntry>(
  entries: T[]
): Array<T & NumberedWikiChapter> {
  const siblingOrders = new Map<string, Set<number>>()

  entries.forEach((entry) => {
    const parts = parseWikiChapterOrder(entry.chapterOrder)

    parts.forEach((part, index) => {
      const parentKey = parts.slice(0, index).join('-')
      const values = siblingOrders.get(parentKey) || new Set<number>()
      values.add(part)
      siblingOrders.set(parentKey, values)
    })
  })

  const siblingIndexes = new Map<string, Map<number, number>>()

  siblingOrders.forEach((values, parentKey) => {
    const indexes = new Map<number, number>()
    Array.from(values)
      .sort((a, b) => a - b)
      .forEach((value, index) => indexes.set(value, index + 1))
    siblingIndexes.set(parentKey, indexes)
  })

  return entries.map((entry) => {
    const parts = parseWikiChapterOrder(entry.chapterOrder)
    const chapter = parts
      .map((part, index) => {
        const parentKey = parts.slice(0, index).join('-')
        return siblingIndexes.get(parentKey)?.get(part)
      })
      .filter((part): part is number => Boolean(part))
      .join('.')

    return {
      ...entry,
      chapter: chapter || undefined,
      chapterDepth: Math.max(0, parts.length - 1)
    }
  })
}
