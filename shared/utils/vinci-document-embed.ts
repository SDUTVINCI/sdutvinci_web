const legacyDocumentWrapperPattern = /<div\b[^>]*>\s*(<iframe\b[^>]*(?:>\s*<\/iframe>|\/\s*>))\s*<\/div>/gi
const iframeSourcePattern = /\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i

const normalizeFeishuDocumentUrl = (value: string) => {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:') return ''
    if (url.hostname !== 'feishu.cn' && !url.hostname.endsWith('.feishu.cn')) return ''
    return url.toString().replaceAll('"', '%22')
  } catch {
    return ''
  }
}

/**
 * Keeps legacy Markdown untouched while upgrading the old full-viewport Feishu
 * wrapper in the final render tree. Other raw HTML and iframe providers are
 * deliberately left alone.
 */
export const resolveLegacyDocumentEmbeds = (markdown: string) =>
  markdown.replace(legacyDocumentWrapperPattern, (source, iframe: string) => {
    const match = iframeSourcePattern.exec(iframe)
    const url = normalizeFeishuDocumentUrl(match?.[1] || match?.[2] || match?.[3] || '')
    if (!url) return source
    return `::vinci-document-embed{src="${url}" provider="飞书" title="飞书在线文档"}\n::`
  })
