export interface SearchTextPart {
  text: string
  match: boolean
}

// Render these parts as text nodes and <mark>; never interpret search text as HTML.
export const highlightSearchText = (text: string, query: string): SearchTextPart[] => {
  const keyword = query.trim()
  if (!keyword) return [{ text, match: false }]
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text.split(new RegExp(`(${escaped})`, 'gi'))
    .map((part, index) => ({ text: part, match: index % 2 === 1 }))
    .filter(part => part.text.length > 0)
}

export const createSearchSnippet = (body: string, query: string): string => {
  const text = body
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:#{1,6}\s+|```[^\n]*|~~~[^\n]*)/gm, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const keyword = query.trim()
  const match = text.toLowerCase().indexOf(keyword.toLowerCase())
  const start = Math.max(0, match - Math.min(60, Math.max(0, 240 - keyword.length)))
  const end = Math.min(text.length, start + 240)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}
