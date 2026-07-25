import { parseDocument, stringify } from 'yaml'

export interface ParsedMarkdown {
  frontmatter: Record<string, unknown>
  body: string
}

const frontmatterPattern = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

const jsonSafe = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(jsonSafe)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, jsonSafe(item)])
    )
  }
  return value
}

export const parseCmsMarkdown = (source: string): ParsedMarkdown => {
  const match = source.match(frontmatterPattern)
  if (!match) {
    return { frontmatter: {}, body: source }
  }

  // 旧成员档案中存在 Tab 缩进；只在解析副本中兼容，原文仍原样保留。
  const yamlSource = match[1]!.replace(/^(\t+)/gm, tabs => '  '.repeat(tabs.length))
  const document = parseDocument(yamlSource, {
    prettyErrors: true,
    strict: false
  })
  if (document.errors.length) {
    throw new Error(`Frontmatter 解析失败：${document.errors[0]!.message}`)
  }

  const value = document.toJS({ maxAliasCount: 50 })
  const frontmatter = value && typeof value === 'object' && !Array.isArray(value)
    ? jsonSafe(value) as Record<string, unknown>
    : {}

  return {
    frontmatter,
    body: source.slice(match[0].length)
  }
}

export const writeCmsMarkdown = (
  frontmatter: Record<string, unknown>,
  body: string
) => `---\n${stringify(frontmatter, { lineWidth: 0 }).trimEnd()}\n---\n${body}`

export const insertStableMemberId = (source: string, memberKey: string) => {
  const match = source.match(frontmatterPattern)
  if (!match) {
    throw new Error('成员资料缺少 Frontmatter')
  }

  const parsed = parseCmsMarkdown(source)
  if (typeof parsed.frontmatter.id === 'string' && parsed.frontmatter.id) {
    return source
  }

  const lines = match[1]!.split(/\r?\n/)
  const nameIndex = lines.findIndex(line => /^name\s*:/.test(line))
  lines.splice(nameIndex >= 0 ? nameIndex + 1 : 0, 0, `id: ${memberKey}`)
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  const replacement = `---${newline}${lines.join(newline)}${newline}---${newline}`
  return replacement + source.slice(match[0].length)
}
