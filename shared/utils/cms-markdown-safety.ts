export interface MarkdownVisualSafety {
  allowed: boolean
  reasons: string[]
}

const checks: Array<{ pattern: RegExp, reason: string }> = [
  {
    pattern: /<\/?[A-Za-z][^>\n]*>/,
    reason: '正文包含原始 HTML 或 Vue 组件'
  },
  {
    pattern: /\{[%{][\s\S]*?[%}]\}/,
    reason: '正文包含模板扩展语法'
  },
  {
    pattern: /(^|\n)\s*:{2,}[A-Za-z]/,
    reason: '正文包含 MDC 容器语法'
  },
  {
    pattern: /(^|\n)\s*@[A-Za-z][\w-]*\b/,
    reason: '正文包含未知指令语法'
  }
]

export const assessMarkdownVisualSafety = (markdown: string): MarkdownVisualSafety => {
  const reasons = checks
    .filter(check => check.pattern.test(markdown))
    .map(check => check.reason)

  return {
    allowed: reasons.length === 0,
    reasons
  }
}

export const normalizeMarkdownRoundTrip = (markdown: string) =>
  markdown
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .trim()
