#!/usr/bin/env tsx

import type { ComarkNode, ComarkTree } from 'comark'
import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'comark'
import { parseMarkdown } from '@nuxtjs/mdc/runtime'
import {
  createVinciMarkdownPlugins,
  protectVinciTemplateTokens,
  vinciMarkdownOptions
} from '../shared/utils/vinci-markdown'

const repositoryRoot = resolve(import.meta.dirname, '..')
const contentRoot = resolve(repositoryRoot, 'content')
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

const snapshotNuxt = (root: any) => {
  const snapshot = emptySnapshot()
  const visit = (node: any) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'text') {
      snapshot.text += String(node.value || '')
      return
    }
    if (node.type === 'element') {
      const tag = normalizedTag(String(node.tag || ''))
      incrementSemanticTag(snapshot, tag)
      if (/^h[1-6]$/.test(tag)) {
        const before = snapshot.text
        const headingText = { value: '' }
        const collect = (child: any) => {
          if (child?.type === 'text') headingText.value += String(child.value || '')
          for (const nested of child?.children || []) collect(nested)
        }
        for (const child of node.children || []) collect(child)
        snapshot.headings.push({
          tag,
          id: String(node.props?.id || ''),
          text: normalizeText(headingText.value)
        })
        snapshot.text = before
      }
    }
    for (const child of node.children || []) visit(child)
  }
  visit(root)
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

const compareSnapshots = (
  legacy: SemanticSnapshot,
  comark: SemanticSnapshot
): CompatibilityIssue[] => {
  const issues: CompatibilityIssue[] = []
  for (const tag of semanticTags) {
    if (legacy.counts[tag] !== comark.counts[tag]) {
      issues.push({
        kind: `tag-count:${tag}`,
        legacy: legacy.counts[tag],
        comark: comark.counts[tag],
        resolution: '已记录结构差异；阶段 4 影子页视觉核对前不切换生产前台'
      })
    }
  }
  if (JSON.stringify(legacy.headings) !== JSON.stringify(comark.headings)) {
    issues.push({
      kind: 'heading-id-or-text',
      legacy: legacy.headings,
      comark: comark.headings,
      resolution: 'Vinci heading 插件使用与 Nuxt Content 相同的 github-slugger 规则'
    })
  }
  return issues
}

export const buildV2ComarkCompatibilityReport = async () => {
  const paths = await listMarkdown(contentRoot)
  const plugins = createVinciMarkdownPlugins()
  const files = []
  let rendered = 0
  let renderFailures = 0
  let filesWithDifferences = 0
  let issueCount = 0

  for (const absolutePath of paths) {
    const path = posixPath(relative(repositoryRoot, absolutePath))
    const source = await readFile(absolutePath, 'utf8')
    const body = source.replace(frontmatterPattern, '')
    const preparedBody = protectVinciTemplateTokens(body)
    const sourceHash = createHash('sha256').update(source).digest('hex')
    try {
      const [legacyTree, comarkTree] = await Promise.all([
        parseMarkdown(body),
        parse(preparedBody, {
          ...vinciMarkdownOptions,
          plugins
        })
      ])
      const legacy = snapshotNuxt(legacyTree.body)
      const comark = snapshotComark(comarkTree)
      const issues = compareSnapshots(legacy, comark)
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
        legacy: {
          counts: legacy.counts,
          headings: legacy.headings
        },
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
          resolution: '阻塞阶段 4 影子运行；修复前继续保留 Nuxt Content'
        }]
      })
    }
  }

  return {
    formatVersion: 1,
    renderer: {
      comark: '0.5.1',
      nuxtContentMdc: '0.22.2',
      headingSlugger: 'github-slugger@2.0.0',
      security: {
        blockedTags: ['script', 'style', 'object', 'embed', 'base', 'meta', 'link'],
        removesEventHandlers: true,
        blocksUnsafeProtocols: true,
        allowsLegacyIframe: true,
        trustBoundary: 'CMS preview is sanitized; production remains Nuxt Content in phase 3'
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
