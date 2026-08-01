#!/usr/bin/env tsx

import type { ComarkNode, ComarkTree } from 'comark'
import { createHash } from 'node:crypto'
import { readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'comark'
import {
  createVinciMarkdownPlugins,
  protectVinciTemplateTokens,
  vinciMarkdownOptions
} from '../shared/utils/vinci-markdown'

const repositoryRoot = resolve(import.meta.dirname, '..')
const defaultReportPath = resolve(
  repositoryRoot,
  'docs/v2/PHASE_V2_3_COMARK_COMPATIBILITY.json'
)
const frontmatterPattern = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/
const semanticTags = [
  'heading',
  'table',
  'pre',
  'img',
  'a',
  'nuxt-link',
  'iframe',
  'br'
] as const

interface SemanticSnapshot {
  counts: Record<(typeof semanticTags)[number], number>
  headings: Array<{ tag: string, id: string, text: string }>
  text: string
}

interface CompatibilityIssue {
  kind: string
  legacy: unknown
  comark: unknown
  resolution: string
}

const posixPath = (path: string) => path.split(sep).join('/')
const normalizeText = (value: string) => value.replace(/\s+/g, ' ').trim()
const normalizedTag = (tag: string) =>
  tag === 'nuxtlink' ? 'nuxt-link' : tag.toLowerCase()

const emptySnapshot = (): SemanticSnapshot => ({
  counts: Object.fromEntries(semanticTags.map(tag => [tag, 0])) as SemanticSnapshot['counts'],
  headings: [],
  text: ''
})

const incrementSemanticTag = (snapshot: SemanticSnapshot, tag: string) => {
  const normalized = normalizedTag(tag)
  if (/^h[1-6]$/.test(normalized)) snapshot.counts.heading += 1
  if (semanticTags.includes(normalized as (typeof semanticTags)[number])) {
    snapshot.counts[normalized as (typeof semanticTags)[number]] += 1
  }
}

const comarkText = (node: ComarkNode): string => {
  if (typeof node === 'string') return node
  return node.slice(2).map(comarkText).join('')
}

const snapshotComark = (tree: ComarkTree) => {
  const snapshot = emptySnapshot()
  const visit = (node: ComarkNode) => {
    if (typeof node === 'string') {
      snapshot.text += node
      return
    }
    const tag = normalizedTag(node[0])
    incrementSemanticTag(snapshot, tag)
    if (/^h[1-6]$/.test(tag)) {
      snapshot.headings.push({
        tag,
        id: String(node[1]?.id || ''),
        text: normalizeText(comarkText(node))
      })
    }
    node.slice(2).forEach(visit)
  }
  tree.nodes.forEach(visit)
  snapshot.text = normalizeText(snapshot.text)
  return snapshot
}

const listMarkdown = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return listMarkdown(path)
    return entry.isFile() && entry.name.endsWith('.md') ? [path] : []
  }))
  return nested.flat().sort()
}

export const buildV2ComarkCompatibilityReport = async () => {
  const configuredSource = process.env.V2_CONTENT_SNAPSHOT_SOURCE?.trim()
  if (!configuredSource) {
    throw new Error('V2_CONTENT_SNAPSHOT_SOURCE 必须指向独立内容仓库快照根目录')
  }
  const contentRoot = await realpath(resolve(configuredSource))
  const codeRoot = await realpath(repositoryRoot)
  if (contentRoot === codeRoot || contentRoot.startsWith(`${codeRoot}${sep}`)) {
    throw new Error('Comark 审计拒绝读取代码仓库内目录')
  }
  const paths = (await Promise.all(
    ['news', 'wiki', 'members'].map(collection =>
      listMarkdown(resolve(contentRoot, collection))
    )
  )).flat().sort()
  const plugins = createVinciMarkdownPlugins()
  const files = []
  let rendered = 0
  let renderFailures = 0
  let filesWithDifferences = 0
  let issueCount = 0

  for (const absolutePath of paths) {
    const path = posixPath(relative(contentRoot, absolutePath))
    const source = await readFile(absolutePath, 'utf8')
    const body = source.replace(frontmatterPattern, '')
    const preparedBody = protectVinciTemplateTokens(body)
    const sourceHash = createHash('sha256').update(source).digest('hex')
    try {
      const comarkTree = await parse(preparedBody, {
        ...vinciMarkdownOptions,
        plugins
      })
      const comark = snapshotComark(comarkTree)
      const issues: CompatibilityIssue[] = []
      const templateTokens = [...body.matchAll(
        /\{%[\s\S]*?%\}|\{\{[\s\S]*?\}\}|\{#[\s\S]*?#\}/g
      )]
        .map(match => match[0])
        .filter(token => preparedBody.includes(
          token.replaceAll('{', '&#123;').replaceAll('}', '&#125;')
        ))
      for (const token of templateTokens) {
        if (!comark.text.includes(normalizeText(token))) {
          issues.push({
            kind: 'template-token-not-visible',
            legacy: token,
            comark: null,
            resolution: 'Vinci 模板 token 兼容层应把未知 token 显示为原文'
          })
        }
      }
      rendered += 1
      issueCount += issues.length
      if (issues.length) filesWithDifferences += 1
      files.push({
        path,
        sourceHash,
        status: issues.length ? 'difference-recorded' : 'compatible',
        syntax: {
          nuxtLink: (body.match(/<NuxtLink\b/g) || []).length,
          mdc: (body.match(/(?:^|\n)\s*:{2,}[A-Za-z]/g) || []).length,
          templateTokens: templateTokens.length,
          rawHtml: (body.match(/<\/?[A-Za-z][^>\n]*>/g) || []).length
        },
        legacy: null,
        comark: {
          counts: comark.counts,
          headings: comark.headings
        },
        issues
      })
    } catch (error) {
      renderFailures += 1
      files.push({
        path,
        sourceHash,
        status: 'render-failed',
        syntax: null,
        legacy: null,
        comark: null,
        issues: [{
          kind: 'render-failed',
          legacy: null,
          comark: error instanceof Error ? error.message : String(error),
          resolution: '阻塞独立内容仓库的 Comark 完整性验收'
        }]
      })
    }
  }

  return {
    formatVersion: 2,
    source: {
      kind: 'independent-content-repository-snapshot',
      root: contentRoot
    },
    renderer: {
      comark: '0.5.1',
      headingSlugger: 'github-slugger@2.0.0',
      security: {
        blockedTags: ['script', 'style', 'object', 'embed', 'base', 'meta', 'link'],
        removesEventHandlers: true,
        blocksUnsafeProtocols: true,
        allowsLegacyIframe: true,
        trustBoundary: 'CMS preview and production pages use the same sanitized Comark pipeline'
      }
    },
    summary: {
      scanned: paths.length,
      rendered,
      renderFailures,
      compatible: rendered - filesWithDifferences,
      filesWithDifferences,
      issueCount
    },
    files
  }
}

const isCli = process.argv[1]
  && fileURLToPath(import.meta.url) === resolve(process.argv[1])

if (isCli) {
  const report = await buildV2ComarkCompatibilityReport()
  if (process.argv.includes('--write')) {
    await writeFile(defaultReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  }
  process.stdout.write(`${JSON.stringify(report.summary, null, 2)}\n`)
  if (report.summary.renderFailures > 0) process.exitCode = 1
}
