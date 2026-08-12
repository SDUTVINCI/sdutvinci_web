type SyntaxWarning =
  | 'RAW_HTML_OR_VUE'
  | 'EXECUTABLE_HTML'
  | 'MDC_OR_VUE'
  | 'UNKNOWN_EXTENSION_SYNTAX'

const stripCode = (source: string) => source
  .replace(/```[\s\S]*?```/g, '')
  .replace(/~~~[\s\S]*?~~~/g, '')
  .replace(/`[^`\n]*`/g, '')

const matches = (source: string, pattern: RegExp) => [...source.matchAll(pattern)]
  .map(match => match[0].trim().replace(/\s+/g, ' ').toLowerCase())

const featureCounts = (source: string) => {
  const visible = stripCode(source)
  const features = new Map<SyntaxWarning, string[]>([
    ['RAW_HTML_OR_VUE', matches(visible, /<\/?[A-Za-z][^>\n]*>/g)],
    ['EXECUTABLE_HTML', [
      ...matches(visible, /<(?:script|style)\b[^>\n]*>[\s\S]*?<\/(?:script|style)\s*>/gi),
      ...matches(visible, /<(?:script|style|iframe|object|embed)\b[^>\n]*>/gi),
      ...matches(visible, /\son[a-z]+\s*=\s*(?:"[^"\n]*"|'[^'\n]*'|[^\s>\n]+)/gi),
      ...matches(visible, /(?:javascript|data)\s*:/gi)
    ]],
    ['MDC_OR_VUE', matches(visible, /(^|\n)\s*:{2,}[A-Za-z][^\n]*/g)],
    ['UNKNOWN_EXTENSION_SYNTAX', [
      ...matches(visible, /\{[%{][\s\S]*?[%}]\}/g),
      ...matches(visible, /(^|\n)\s*@[A-Za-z][^\n]*/g)
    ]]
  ])
  return new Map([...features].map(([warning, values]) => {
    const counts = new Map<string, number>()
    for (const value of values) counts.set(value, (counts.get(value) || 0) + 1)
    return [warning, counts]
  }))
}

export const addedSyntaxWarnings = (baseSource: string, proposedSource: string) => {
  const base = featureCounts(baseSource)
  const proposed = featureCounts(proposedSource)
  const warnings: SyntaxWarning[] = []
  for (const [warning, proposedCounts] of proposed) {
    const baseCounts = base.get(warning)!
    if ([...proposedCounts].some(([feature, count]) => count > (baseCounts.get(feature) || 0))) {
      warnings.push(warning)
    }
  }
  return warnings
}
