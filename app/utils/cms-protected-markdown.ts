import { $node, $prose, $remark } from '@milkdown/kit/utils'
import { Plugin } from '@milkdown/kit/prose/state'
import { remark } from 'remark'

interface MarkdownAstNode {
  type: string
  value?: string
  children?: MarkdownAstNode[]
  position?: {
    start?: { offset?: number }
    end?: { offset?: number }
  }
}

const protectedNodeNames = new Set([
  'vinciProtectedHtmlBlock',
  'vinciProtectedHtmlInline'
])

const encodeSource = (source: string) =>
  Array.from(new TextEncoder().encode(source))
    .map(value => value.toString(16).padStart(2, '0'))
    .join('')

const decodeSource = (encoded: string) => {
  const bytes = encoded.match(/.{2}/g)?.map(value => Number.parseInt(value, 16)) || []
  return new TextDecoder().decode(new Uint8Array(bytes))
}

const markerFor = (source: string, block: boolean) =>
  `VINCIEXTENSION${block ? 'BLOCK' : 'INLINE'}${encodeSource(source)}ENDTOKEN`

const parseMarker = (value: string) => {
  const match = /^VINCIEXTENSION(BLOCK|INLINE)([0-9a-f]+)ENDTOKEN$/.exec(value)
  return match
    ? { block: match[1] === 'BLOCK', source: decodeSource(match[2] || '') }
    : null
}

export const prepareMarkdownForVisualEditor = (markdown: string) => {
  const tree = remark().parse(markdown) as MarkdownAstNode
  const regions: Array<{ start: number, end: number, block: boolean }> = []

  const visit = (node: MarkdownAstNode, parent?: MarkdownAstNode) => {
    if (node.type === 'html') {
      const start = node.position?.start?.offset
      const end = node.position?.end?.offset
      if (typeof start === 'number' && typeof end === 'number') {
        regions.push({
          start,
          end,
          block: parent?.type !== 'paragraph'
        })
      }
      return
    }
    for (const child of node.children || []) {
      visit(child, node)
    }
  }

  visit(tree)
  return regions
    .sort((left, right) => right.start - left.start)
    .reduce((result, region) => {
      const source = result.slice(region.start, region.end)
      return result.slice(0, region.start)
        + markerFor(source, region.block)
        + result.slice(region.end)
    }, markdown)
}

const describeProtectedSyntax = (source: string) => {
  const trimmed = source.trim()
  if (/^\{%/.test(trimmed)) {
    return '模板指令 {%…%}'
  }
  if (/^\{\{/.test(trimmed)) {
    return '模板表达式 {{…}}'
  }
  if (/^:{2,}/.test(trimmed)) {
    return 'MDC 容器指令'
  }
  if (/^@[A-Za-z]/.test(trimmed)) {
    return '扩展指令'
  }
  if (/^<!--/.test(source.trim())) {
    return 'HTML 注释'
  }

  const match = source.match(/^<\s*(\/?)\s*([A-Za-z][\w.:-]*)/)
  if (!match) {
    return '扩展语法'
  }

  const [, closing, name] = match
  const kind = /^[A-Z]/.test(name || '') ? 'Vue 组件' : 'HTML'
  return `${kind} <${closing ? '/' : ''}${name}>`
}

const protectedTextPattern =
  /VINCIEXTENSION(?:BLOCK|INLINE)[0-9a-f]+ENDTOKEN|\{%[\s\S]*?%\}|\{\{[\s\S]*?\}\}|^:{2,}[A-Za-z][^\n]*$|^:{2,}$|^@[A-Za-z][\w-]*\b[^\n]*$/gm

const splitProtectedText = (value: string): MarkdownAstNode[] => {
  const nodes: MarkdownAstNode[] = []
  let cursor = 0

  for (const match of value.matchAll(protectedTextPattern)) {
    const index = match.index
    if (index > cursor) {
      nodes.push({ type: 'text', value: value.slice(cursor, index) })
    }
    const marker = parseMarker(match[0])
    nodes.push({
      type: marker ? 'vinciProtectedHtmlInline' : 'vinciProtectedTemplateInline',
      value: marker?.source || match[0]
    })
    cursor = index + match[0].length
  }

  if (cursor < value.length) {
    nodes.push({ type: 'text', value: value.slice(cursor) })
  }

  return nodes.length > 0 ? nodes : [{ type: 'text', value }]
}

const protectHtmlRemark = $remark(
  'vinciProtectExtendedSyntax',
  () => () => (tree: MarkdownAstNode) => {
    const visit = (node: MarkdownAstNode) => {
      const children = node.children || []
      if (
        node.type === 'paragraph'
        && children.length === 1
        && children[0]?.type === 'text'
      ) {
        const marker = parseMarker(children[0].value || '')
        if (marker?.block) {
          node.type = 'vinciProtectedHtmlBlock'
          node.value = marker.source
          delete node.children
          return
        }
      }

      for (let index = 0; index < children.length; index += 1) {
        const child = children[index]!
        if (child.type === 'html') {
          child.type = node.type === 'paragraph'
            ? 'vinciProtectedHtmlInline'
            : 'vinciProtectedHtmlBlock'
          continue
        }
        if (child.type === 'text' && protectedTextPattern.test(child.value || '')) {
          protectedTextPattern.lastIndex = 0
          const replacements = splitProtectedText(child.value || '')
          children.splice(index, 1, ...replacements)
          index += replacements.length - 1
          continue
        }
        protectedTextPattern.lastIndex = 0
        visit(child)
      }
    }

    visit(tree)
  }
)

const protectedAttrs = {
  source: { default: '' },
  label: { default: '扩展语法' },
  outputType: { default: 'html' }
}

const protectedHtmlInline = $node('vinciProtectedHtmlInline', () => ({
  group: 'inline',
  inline: true,
  atom: true,
  isolating: true,
  selectable: true,
  marks: '',
  attrs: protectedAttrs,
  parseDOM: [{ tag: 'span[data-vinci-protected-html="inline"]' }],
  toDOM: node => [
    'span',
    {
      class: 'cms-protected-syntax cms-protected-syntax-inline',
      contenteditable: 'false',
      'data-vinci-protected-html': 'inline',
      title: node.attrs.source
    },
    node.attrs.label
  ],
  parseMarkdown: {
    match: node => (
      node.type === 'vinciProtectedHtmlInline'
      || node.type === 'vinciProtectedTemplateInline'
    ),
    runner: (state, node, type) => {
      const source = String(node.value || '')
      state.addNode(type, {
        source,
        label: describeProtectedSyntax(source),
        outputType: node.type === 'vinciProtectedHtmlInline' ? 'html' : 'text'
      })
    }
  },
  toMarkdown: {
    match: node => node.type.name === 'vinciProtectedHtmlInline',
    runner: (state, node) => {
      state.addNode(
        String(node.attrs.outputType || 'html'),
        undefined,
        String(node.attrs.source || '')
      )
    }
  }
}))

const protectedHtmlBlock = $node('vinciProtectedHtmlBlock', () => ({
  group: 'block',
  atom: true,
  isolating: true,
  selectable: true,
  marks: '',
  attrs: protectedAttrs,
  parseDOM: [{ tag: 'div[data-vinci-protected-html="block"]' }],
  toDOM: node => [
    'div',
    {
      class: 'cms-protected-syntax cms-protected-syntax-block',
      contenteditable: 'false',
      'data-vinci-protected-html': 'block',
      title: node.attrs.source
    },
    ['strong', {}, node.attrs.label],
    ['small', {}, '受保护区域 · 请在源码模式修改']
  ],
  parseMarkdown: {
    match: node => node.type === 'vinciProtectedHtmlBlock',
    runner: (state, node, type) => {
      const source = String(node.value || '')
      state.addNode(type, {
        source,
        label: describeProtectedSyntax(source),
        outputType: 'html'
      })
    }
  },
  toMarkdown: {
    match: node => node.type.name === 'vinciProtectedHtmlBlock',
    runner: (state, node) => {
      state.addNode('html', undefined, String(node.attrs.source || ''))
    }
  }
}))

const protectedHtmlGuard = $prose(() => new Plugin({
  filterTransaction: (transaction, state) => {
    if (!transaction.docChanged) {
      return true
    }

    const collect = (doc: typeof state.doc) => {
      const sources: string[] = []
      doc.descendants((node) => {
        if (protectedNodeNames.has(node.type.name)) {
          sources.push(String(node.attrs.source || ''))
        }
      })
      return sources
    }

    const before = collect(state.doc)
    if (before.length === 0) {
      return true
    }

    const after = collect(transaction.doc)
    return before.length === after.length
      && before.every((source, index) => source === after[index])
  }
}))

export const cmsProtectedMarkdownPlugins = [
  ...protectHtmlRemark,
  protectedHtmlInline,
  protectedHtmlBlock,
  protectedHtmlGuard
]
