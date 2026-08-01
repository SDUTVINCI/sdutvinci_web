import { diffLines } from 'diff'

export type ContentImportDiffLineKind = 'context' | 'added' | 'removed'

export interface ContentImportDiffLine {
  kind: ContentImportDiffLineKind
  prefix: ' ' | '+' | '-'
  text: string
  oldLine: number | null
  newLine: number | null
}

const sourceLines = (source: string) => {
  if (!source) return []
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

export const buildContentImportContext = (source: string): ContentImportDiffLine[] =>
  sourceLines(source).map((text, index) => ({
    kind: 'context',
    prefix: ' ',
    text,
    oldLine: index + 1,
    newLine: index + 1
  }))

export const buildContentImportDiff = (
  before: string,
  after: string
): ContentImportDiffLine[] => {
  let oldLine = 1
  let newLine = 1
  const result: ContentImportDiffLine[] = []

  for (const change of diffLines(
    before.replace(/\r\n?/g, '\n'),
    after.replace(/\r\n?/g, '\n'),
    { oneChangePerToken: true }
  )) {
    const kind: ContentImportDiffLineKind = change.added
      ? 'added'
      : change.removed ? 'removed' : 'context'
    for (const text of sourceLines(change.value)) {
      result.push({
        kind,
        prefix: kind === 'added' ? '+' : kind === 'removed' ? '-' : ' ',
        text,
        oldLine: kind === 'added' ? null : oldLine,
        newLine: kind === 'removed' ? null : newLine
      })
      if (kind !== 'added') oldLine += 1
      if (kind !== 'removed') newLine += 1
    }
  }

  return result
}
