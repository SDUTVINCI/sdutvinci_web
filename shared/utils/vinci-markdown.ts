import type { ComarkElement, ComarkNode, ComarkPlugin } from 'comark'
import githubDark from '@shikijs/themes/github-dark'
import githubLight from '@shikijs/themes/github-light'
import astro from '@shikijs/langs/astro'
import bash from '@shikijs/langs/bash'
import c from '@shikijs/langs/c'
import cmake from '@shikijs/langs/cmake'
import cpp from '@shikijs/langs/cpp'
import csharp from '@shikijs/langs/csharp'
import css from '@shikijs/langs/css'
import dart from '@shikijs/langs/dart'
import diff from '@shikijs/langs/diff'
import dockerfile from '@shikijs/langs/dockerfile'
import gitCommit from '@shikijs/langs/git-commit'
import go from '@shikijs/langs/go'
import html from '@shikijs/langs/html'
import ini from '@shikijs/langs/ini'
import java from '@shikijs/langs/java'
import javascript from '@shikijs/langs/javascript'
import json from '@shikijs/langs/json'
import kotlin from '@shikijs/langs/kotlin'
import lua from '@shikijs/langs/lua'
import make from '@shikijs/langs/make'
import markdown from '@shikijs/langs/markdown'
import nginx from '@shikijs/langs/nginx'
import php from '@shikijs/langs/php'
import powershell from '@shikijs/langs/powershell'
import python from '@shikijs/langs/python'
import r from '@shikijs/langs/r'
import ruby from '@shikijs/langs/ruby'
import rust from '@shikijs/langs/rust'
import scala from '@shikijs/langs/scala'
import scss from '@shikijs/langs/scss'
import sql from '@shikijs/langs/sql'
import svelte from '@shikijs/langs/svelte'
import swift from '@shikijs/langs/swift'
import toml from '@shikijs/langs/toml'
import tsx from '@shikijs/langs/tsx'
import typescript from '@shikijs/langs/typescript'
import vue from '@shikijs/langs/vue'
import xml from '@shikijs/langs/xml'
import yaml from '@shikijs/langs/yaml'
import GithubSlugger from 'github-slugger'
import { remark } from 'remark'
import highlight from 'comark/plugins/highlight'
import taskList from 'comark/plugins/task-list'
import toc from 'comark/plugins/toc'
import { resolveStaticMediaUrl } from './static-media'

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

export const resolveVinciStaticMedia = (): ComarkPlugin => ({
  name: 'vinci-static-media-cdn',
  post(state) {
    visitComarkNodes(state.tree.nodes as VinciComarkNode[], (node) => {
      const props = node[1] || {}
      for (const [name, value] of Object.entries(props)) {
        if (typeof value === 'string') props[name] = resolveStaticMediaUrl(value)
      }
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

const executableProtocolPattern = /^(?:javascript|vbscript|data\s*:\s*(?:text\/(?:html|javascript|vbscript)|application\/javascript))/i

const decodeCodePoint = (value: string, radix: number) => {
  const codePoint = Number.parseInt(value, radix)
  return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : ''
}

const containsExecutableProtocol = (value: unknown) => {
  if (typeof value !== 'string') return false
  let normalized = value.trim().replace(/[\u0000-\u0020\u007f]+/g, '')
  try {
    normalized = decodeURIComponent(normalized)
  } catch {
    // Keep malformed escapes as plain text and still run the direct check.
  }
  normalized = normalized
    .replace(/&#x([0-9a-f]+);?/gi, (_match, value) => decodeCodePoint(value, 16))
    .replace(/&#(\d+);?/g, (_match, value) => decodeCodePoint(value, 10))
    .replace(/&colon;?/gi, ':')
    .replace(/&(tab|newline);?/gi, '')
    .replace(/[\u0000-\u0020\u007f]+/g, '')
  return executableProtocolPattern.test(normalized)
}

const preventExecutableHtml = (): ComarkPlugin => ({
  name: 'vinci-executable-html-safety',
  post(state) {
    const sanitize = (container: any[], start = 0) => {
      for (let index = start; index < container.length; index += 1) {
        const node = container[index]
        if (typeof node === 'string' || node[0] === null) continue
        if (String(node[0]).toLowerCase() === 'script') {
          container[index] = blockedTagFallback(node as ComarkElement)
          continue
        }

        const props = node[1] || {}
        node[1] = Object.fromEntries(
          Object.entries(props).filter(([name, value]) => {
            const normalizedName = name.toLowerCase()
            return !normalizedName.startsWith('on')
              && normalizedName !== 'srcdoc'
              && !containsExecutableProtocol(value)
          })
        )
        sanitize(node, 2)
      }
    }
    sanitize(state.tree.nodes as VinciComarkNode[])
  }
})

export const vinciShikiLanguages = [
  astro,
  bash,
  c,
  cmake,
  cpp,
  csharp,
  css,
  dart,
  diff,
  dockerfile,
  gitCommit,
  go,
  html,
  ini,
  java,
  javascript,
  json,
  kotlin,
  lua,
  make,
  markdown,
  nginx,
  php,
  powershell,
  python,
  r,
  ruby,
  rust,
  scala,
  scss,
  sql,
  svelte,
  swift,
  toml,
  tsx,
  typescript,
  vue,
  xml,
  yaml
]

export const createVinciMarkdownPlugins = (): ComarkPlugin<any, any>[] => [
  taskList(),
  removeComarkComments(),
  vinciHeadingIds(),
  resolveVinciStaticMedia(),
  toc({ depth: 5, searchDepth: 8 }),
  preventExecutableHtml(),
  highlight({
    preStyles: false,
    registerDefaultLanguages: false,
    languages: vinciShikiLanguages,
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
