import type { ComarkElement, ComarkNode, ComarkPlugin } from 'comark'
import githubDark from '@shikijs/themes/github-dark'
import githubLight from '@shikijs/themes/github-light'
import GithubSlugger from 'github-slugger'
import { remark } from 'remark'
import highlight from 'comark/plugins/highlight'
import security from 'comark/plugins/security'
import taskList from 'comark/plugins/task-list'
import toc from 'comark/plugins/toc'

interface MarkdownAstNode {
  type: string
  value?: string
  children?: MarkdownAstNode[]
  position?: {
    start?: { offset?: number }
    end?: { offset?: number }
  }
}

type VinciComarkNode =
  | string
  | [string | null, Record<string, any>, ...VinciComarkNode[]]

const templateTokenPattern = /\{%[\s\S]*?%\}|\{\{[\s\S]*?\}\}|\{#[\s\S]*?#\}/g
const headingTagPattern = /^h[1-6]$/

const encodeTemplateToken = (source: string) =>
  source.replaceAll('{', '&#123;').replaceAll('}', '&#125;')

const textContent = (node: VinciComarkNode): string => {
  if (typeof node === 'string') return node
  let result = ''
  for (let index = 2; index < node.length; index += 1) {
    result += textContent(node[index] as VinciComarkNode)
  }
  return result
}

const visitComarkNodes = (
  nodes: VinciComarkNode[],
  visitor: (node: ComarkElement) => void
) => {
  for (const node of nodes) {
    if (typeof node === 'string') continue
    if (node[0] !== null) visitor(node as ComarkElement)
    visitComarkNodes(node.slice(2) as VinciComarkNode[], visitor)
  }
}

const removeComarkComments = (): ComarkPlugin => ({
  name: 'vinci-comment-compatibility',
  post(state) {
    const removeFrom = (container: any[], start = 0) => {
      for (let index = container.length - 1; index >= start; index -= 1) {
        const node = container[index]!
        if (typeof node === 'string') continue
        if (node[0] === null) {
          container.splice(index, 1)
          continue
        }
        removeFrom(node as any[], 2)
      }
    }
    removeFrom(state.tree.nodes as VinciComarkNode[])
  }
})

export const protectVinciTemplateTokens = (markdown: string) => {
  const tree = remark().parse(markdown) as MarkdownAstNode
  const replacements: Array<{ start: number, end: number, value: string }> = []

  const visit = (node: MarkdownAstNode) => {
    if (
      node.type === 'text'
      && typeof node.value === 'string'
      && node.position?.start?.offset !== undefined
    ) {
      for (const match of node.value.matchAll(templateTokenPattern)) {
        const start = node.position.start.offset + match.index
        replacements.push({
          start,
          end: start + match[0].length,
          value: encodeTemplateToken(match[0])
        })
      }
    }
    for (const child of node.children || []) visit(child)
  }

  visit(tree)
  return replacements
    .sort((left, right) => right.start - left.start)
    .reduce(
      (result, replacement) =>
        result.slice(0, replacement.start)
        + replacement.value
        + result.slice(replacement.end),
      markdown
    )
}

export const vinciHeadingIds = (): ComarkPlugin => ({
  name: 'vinci-heading-ids',
  post(state) {
    const slugger = new GithubSlugger()
    visitComarkNodes(state.tree.nodes as VinciComarkNode[], (node) => {
      if (!headingTagPattern.test(String(node[0] || ''))) return
      const props = node[1] || {}
      const generated = slugger.slug(textContent(node))
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .replace(/^(\d)/, '_$1')
      props.id = generated
      node[1] = props
    })
  }
})

const blockedTagFallback = (element: ComarkElement): ComarkNode => {
  const tag = element[0].toLowerCase()
  return [
    'pre',
    {
      class: 'vinci-markdown-blocked',
      'data-vinci-blocked-tag': tag
    },
    ['code', {}, `<${tag}>${textContent(element as VinciComarkNode)}</${tag}>`]
  ]
}

export const createVinciMarkdownPlugins = (): ComarkPlugin<any, any>[] => [
  taskList(),
  removeComarkComments(),
  vinciHeadingIds(),
  toc({ depth: 5, searchDepth: 8 }),
  security({
    blockedTags: ['script', 'style', 'object', 'embed', 'base', 'meta', 'link'],
    allowedProtocols: ['http', 'https', 'mailto', 'tel'],
    allowDataImages: false,
    tagFallback: blockedTagFallback
  }),
  highlight({
    preStyles: false,
    themes: {
      light: githubLight,
      dark: githubDark
    }
  })
]

export const vinciMarkdownOptions = {
  autoClose: true,
  autoUnwrap: false,
  html: true,
  linkify: true
} as const
