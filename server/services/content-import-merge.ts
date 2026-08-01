import { diffArrays } from 'diff'

interface LineEdit {
  start: number
  end: number
  replacement: string[]
  expandedStart: number
  expandedEnd: number
}
export interface ThreeWayMergeResult {
  merged: string | null
  conflicts: Array<{ startLine: number, endLine: number }>
}

const linesOf = (source: string) => source.replace(/\r\n?/g, '\n').split('\n')

const paragraphBounds = (base: string[], start: number, end: number) => {
  const pivot = Math.min(start, Math.max(0, base.length - 1))
  let expandedStart = pivot
  let expandedEnd = Math.max(pivot, end)
  while (expandedStart > 0 && base[expandedStart - 1] !== '') expandedStart -= 1
  while (expandedEnd < base.length && base[expandedEnd] !== '') expandedEnd += 1
  return { expandedStart, expandedEnd }
}

const editsFrom = (base: string[], variant: string[]) => {
  const changes = diffArrays(base, variant)
  const edits: LineEdit[] = []
  let baseIndex = 0
  let pending: { start: number, end: number, replacement: string[] } | null = null
  const flush = () => {
    if (!pending) return
    edits.push({ ...pending, ...paragraphBounds(base, pending.start, pending.end) })
    pending = null
  }
  for (const change of changes) {
    const values = change.value as string[]
    if (!change.added && !change.removed) {
      flush()
      baseIndex += values.length
    } else if (change.removed) {
      pending ||= { start: baseIndex, end: baseIndex, replacement: [] }
      pending.end += values.length
      baseIndex += values.length
    } else {
      pending ||= { start: baseIndex, end: baseIndex, replacement: [] }
      pending.replacement.push(...values)
    }
  }
  flush()
  return edits
}

const overlapsParagraph = (left: LineEdit, right: LineEdit) =>
  left.expandedStart <= right.expandedEnd && right.expandedStart <= left.expandedEnd

const sameEdit = (left: LineEdit, right: LineEdit) =>
  left.start === right.start
  && left.end === right.end
  && left.replacement.join('\n') === right.replacement.join('\n')

export const mergeMarkdownThreeWay = (
  baseSource: string,
  currentSource: string,
  proposedSource: string
): ThreeWayMergeResult => {
  if (currentSource === proposedSource) return { merged: currentSource, conflicts: [] }
  if (baseSource === currentSource) return { merged: proposedSource, conflicts: [] }
  if (baseSource === proposedSource) return { merged: currentSource, conflicts: [] }
  const base = linesOf(baseSource)
  const currentEdits = editsFrom(base, linesOf(currentSource))
  const proposedEdits = editsFrom(base, linesOf(proposedSource))
  const conflicts: ThreeWayMergeResult['conflicts'] = []
  for (const current of currentEdits) {
    for (const proposed of proposedEdits) {
      if (overlapsParagraph(current, proposed) && !sameEdit(current, proposed)) {
        conflicts.push({
          startLine: Math.min(current.expandedStart, proposed.expandedStart) + 1,
          endLine: Math.max(current.expandedEnd, proposed.expandedEnd) + 1
        })
      }
    }
  }
  if (conflicts.length) return { merged: null, conflicts }
  const unique = [...currentEdits, ...proposedEdits].filter((edit, index, all) =>
    all.findIndex(candidate => sameEdit(candidate, edit)) === index
  ).sort((left, right) => right.start - left.start || right.end - left.end)
  const merged = [...base]
  for (const edit of unique) {
    merged.splice(edit.start, edit.end - edit.start, ...edit.replacement)
  }
  return { merged: merged.join('\n'), conflicts: [] }
}
