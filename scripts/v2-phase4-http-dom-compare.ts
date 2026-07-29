#!/usr/bin/env tsx

import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { extname, relative, resolve, sep } from 'node:path'
import { parse } from 'parse5'
import { getCmsArticlePublicPath } from '../server/services/cms-articles'
import { listMarkdownFiles } from '../server/utils/cms-content-path'
import { parseCmsMarkdown } from '../server/utils/cms-frontmatter'

const repositoryRoot = resolve(import.meta.dirname, '..')
const stage3ReportPath = resolve(
  repositoryRoot,
  'docs/v2/PHASE_V2_3_COMARK_COMPATIBILITY.json'
)
const defaultOutputPath = resolve(
  repositoryRoot,
  'docs/v2/PHASE_V2_4_HTTP_DOM_COMPARISON.json'
)
const semanticTags = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'a',
  'br',
  'pre',
  'table',
  'img',
  'iframe'
] as const

type SemanticTag = (typeof semanticTags)[number]
type HtmlNode = {
  nodeName?: string
  tagName?: string
  value?: string
  attrs?: Array<{ name: string, value: string }>
  childNodes?: HtmlNode[]
}

interface Stage3Issue {
  kind: string
  legacy: unknown
  comark: unknown
  resolution: string
}

interface RouteCase {
  path: string
  kind: 'page' | 'missing' | 'legacy-path'
  collection?: 'news' | 'wiki' | 'members'
  sourcePaths: string[]
  stage3Issues: Array<{ sourcePath: string, issues: Stage3Issue[] }>
}

interface HttpSnapshot {
  status: number
  title: string
  description: string
  ogTitle: string
  ogDescription: string
  ogType: string
  ogUrl: string
  canonical: string
  h1: string[]
  semantic: {
    counts: Record<SemanticTag, number>
    headings: Array<{ tag: string, id: string, text: string }>
    textHash: string
    textLength: number
  }
}

const normalizeText = (value: string) => value.replace(/\s+/g, ' ').trim()
const hashText = (value: string) =>
  createHash('sha256').update(value).digest('hex')
const posixPath = (path: string) => path.split(sep).join('/')
const attributes = (node: HtmlNode) =>
  Object.fromEntries((node.attrs || []).map(attribute => [
    attribute.name,
    attribute.value
  ]))
const nodeText = (node: HtmlNode): string => {
  if (node.tagName === 'style' || node.tagName === 'script') return ''
  if (node.nodeName === '#text') return node.value || ''
  return (node.childNodes || []).map(nodeText).join('')
}
const visit = (node: HtmlNode, callback: (node: HtmlNode) => void) => {
  callback(node)
  for (const child of node.childNodes || []) visit(child, callback)
}
const findFirst = (
  root: HtmlNode,
  predicate: (node: HtmlNode) => boolean
) => {
  let result: HtmlNode | undefined
  visit(root, (node) => {
    if (!result && predicate(node)) result = node
  })
  return result
}
const hasClass = (node: HtmlNode, className: string) =>
  String(attributes(node).class || '').split(/\s+/).includes(className)
const elementContentRoot = (document: HtmlNode) =>
  findFirst(document, node =>
    hasClass(node, 'content-prose')
    || hasClass(node, 'wiki-content-body')
    || hasClass(node, 'member-prose')
  ) || findFirst(document, node => node.tagName === 'main') || document
const metaContent = (
  document: HtmlNode,
  attribute: 'name' | 'property',
  value: string
) => attributes(findFirst(document, node => {
  const attrs = attributes(node)
  return node.tagName === 'meta' && attrs[attribute] === value
}) || {}).content || ''
const linkHref = (document: HtmlNode, rel: string) =>
  attributes(findFirst(document, node => {
    const attrs = attributes(node)
    return node.tagName === 'link' && attrs.rel === rel
  }) || {}).href || ''

const snapshotHtml = (status: number, html: string): HttpSnapshot => {
  const document = parse(html) as unknown as HtmlNode
  const contentRoot = elementContentRoot(document)
  const counts = Object.fromEntries(
    semanticTags.map(tag => [tag, 0])
  ) as Record<SemanticTag, number>
  const headings: HttpSnapshot['semantic']['headings'] = []
  const h1: string[] = []
  visit(contentRoot, (node) => {
    const tag = node.tagName as SemanticTag | undefined
    if (!tag || !semanticTags.includes(tag)) return
    counts[tag] += 1
    if (/^h[1-6]$/.test(tag)) {
      const heading = {
        tag,
        id: attributes(node).id || '',
        text: normalizeText(nodeText(node))
      }
      headings.push(heading)
      if (tag === 'h1') h1.push(heading.text)
    }
  })
  const text = normalizeText(nodeText(contentRoot)).replace(/\s+/g, '')
  return {
    status,
    title: normalizeText(nodeText(
      findFirst(document, node => node.tagName === 'title') || {}
    )),
    description: metaContent(document, 'name', 'description'),
    ogTitle: metaContent(document, 'property', 'og:title'),
    ogDescription: metaContent(document, 'property', 'og:description'),
    ogType: metaContent(document, 'property', 'og:type'),
    ogUrl: metaContent(document, 'property', 'og:url'),
    canonical: linkHref(document, 'canonical'),
    h1,
    semantic: {
      counts,
      headings,
      textHash: hashText(text),
      textLength: text.length
    }
  }
}

const option = (name: string) => {
  const prefix = `--${name}=`
  return process.argv.find(argument => argument.startsWith(prefix))
    ?.slice(prefix.length)
}
const legacyBase = option('legacy-base')?.replace(/\/+$/, '')
const databaseBase = option('database-base')?.replace(/\/+$/, '')
const shouldWrite = process.argv.includes('--write')
const outputPath = resolve(repositoryRoot, option('output') || defaultOutputPath)
if (!legacyBase || !databaseBase) {
  throw new Error(
    '必须提供 --legacy-base=http://... 和 --database-base=http://...'
  )
}
if (legacyBase === databaseBase) {
  throw new Error('legacy-base 与 database-base 必须是两个独立 HTTP 实例')
}

const stage3Report = JSON.parse(
  await readFile(stage3ReportPath, 'utf8')
) as {
  summary: {
    filesWithDifferences: number
    issueCount: number
  }
  files: Array<{
    path: string
    issues: Stage3Issue[]
  }>
}
const stage3ByPath = new Map(
  stage3Report.files
    .filter(file => file.issues.length)
    .map(file => [file.path, file.issues])
)

const routeMap = new Map<string, RouteCase>()
const addRoute = (
  path: string,
  input: Omit<RouteCase, 'path' | 'stage3Issues'>
) => {
  const existing = routeMap.get(path)
  if (existing) {
    existing.sourcePaths.push(...input.sourcePaths)
    return
  }
  routeMap.set(path, { path, ...input, stage3Issues: [] })
}

for (const path of ['/', '/news', '/wiki', '/team']) {
  addRoute(path, { kind: 'page', sourcePaths: [] })
}
for (const collection of ['news', 'wiki'] as const) {
  for (const relativePath of await listMarkdownFiles(collection)) {
    addRoute(getCmsArticlePublicPath(collection, relativePath), {
      kind: 'page',
      collection,
      sourcePaths: [`content/${collection}/${relativePath}`]
    })
  }
}
for (const relativePath of await listMarkdownFiles('members')) {
  const sourcePath = `content/members/${relativePath}`
  const source = await readFile(resolve(repositoryRoot, sourcePath), 'utf8')
  const frontmatter = parseCmsMarkdown(source).frontmatter
  const memberKey = String(
    frontmatter.id || frontmatter.memberKey || ''
  ).trim()
  if (!memberKey) {
    throw new Error(`${sourcePath} 缺少阶段 4 稳定成员 ID`)
  }
  addRoute(`/team/${encodeURIComponent(memberKey)}`, {
    kind: 'page',
    collection: 'members',
    sourcePaths: [sourcePath]
  })
}
for (const route of routeMap.values()) {
  route.stage3Issues = route.sourcePaths.flatMap(sourcePath => {
    const issues = stage3ByPath.get(sourcePath)
    return issues ? [{ sourcePath, issues }] : []
  })
}
for (const path of [
  '/news/__phase4-missing',
  '/wiki/__phase4-missing',
  '/team/__phase4-missing'
]) {
  addRoute(path, { kind: 'missing', sourcePaths: [] })
}
const representatives = [...routeMap.values()]
  .filter(route => route.kind === 'page' && route.collection)
  .filter((route, index, routes) =>
    routes.findIndex(item => item.collection === route.collection) === index
  )
for (const representative of representatives) {
  addRoute(`${representative.path}/`, {
    kind: 'legacy-path',
    collection: representative.collection,
    sourcePaths: representative.sourcePaths
  })
}

const fetchSnapshot = async (base: string, path: string) => {
  const response = await fetch(`${base}${path}`, {
    redirect: 'manual',
    headers: { accept: 'text/html' }
  })
  return snapshotHtml(response.status, await response.text())
}
const differenceFields = (
  legacy: HttpSnapshot,
  database: HttpSnapshot
) => {
  const differences: string[] = []
  for (const field of [
    'status',
    'title',
    'description',
    'ogTitle',
    'ogDescription',
    'ogType',
    'ogUrl',
    'canonical',
    'h1'
  ] as const) {
    if (JSON.stringify(legacy[field]) !== JSON.stringify(database[field])) {
      differences.push(field)
    }
  }
  if (legacy.semantic.textHash !== database.semantic.textHash) {
    differences.push('semantic.text')
  }
  if (
    JSON.stringify(legacy.semantic.counts)
    !== JSON.stringify(database.semantic.counts)
  ) {
    differences.push('semantic.counts')
  }
  if (
    JSON.stringify(legacy.semantic.headings)
    !== JSON.stringify(database.semantic.headings)
  ) {
    differences.push('semantic.headings')
  }
  return differences
}

const routeCases = [...routeMap.values()].sort((a, b) =>
  a.path.localeCompare(b.path, 'zh-CN')
)
const results: Array<Record<string, unknown>> = []
for (let offset = 0; offset < routeCases.length; offset += 8) {
  const batch = routeCases.slice(offset, offset + 8)
  const compared = await Promise.all(batch.map(async (route) => {
    const [legacy, database] = await Promise.all([
      fetchSnapshot(legacyBase, route.path),
      fetchSnapshot(databaseBase, route.path)
    ])
    const differences = differenceFields(legacy, database)
    const expectedStatus = route.kind === 'missing' ? 404 : 200
    const statusExpectationMet = (
      legacy.status === expectedStatus
      && database.status === expectedStatus
    )
    const criticalDifferences = differences.filter(field =>
      field === 'status'
      || (!route.stage3Issues.length && field === 'h1')
    )
    if (!statusExpectationMet) criticalDifferences.push('expectedStatus')
    const seoMissing = route.kind === 'page' && legacy.status === 200
      ? [
          ...(!legacy.title || !database.title ? ['title'] : []),
          ...(!legacy.description || !database.description ? ['description'] : []),
          ...(!legacy.ogTitle || !database.ogTitle ? ['ogTitle'] : []),
          ...(!legacy.ogDescription || !database.ogDescription
            ? ['ogDescription']
            : []),
          ...(!legacy.ogUrl || !database.ogUrl ? ['ogUrl'] : []),
          ...(!legacy.canonical || !database.canonical ? ['canonical'] : [])
        ]
      : []
    const classification = !differences.length
      ? 'equivalent'
      : criticalDifferences.length || seoMissing.length
        ? 'mismatch'
        : route.stage3Issues.length
          ? 'stage3-known-difference'
          : 'non-critical-difference'
    return {
      path: route.path,
      kind: route.kind,
      collection: route.collection,
      sourcePaths: route.sourcePaths,
      stage3Issues: route.stage3Issues,
      classification,
      differences,
      expectedStatus,
      statusExpectationMet,
      criticalDifferences,
      seoMissing,
      legacy,
      database
    }
  }))
  results.push(...compared)
}

const mappedStage3Files = new Set(
  results.flatMap(result =>
    (result.stage3Issues as RouteCase['stage3Issues'])
      .map(item => item.sourcePath)
  )
)
const mappedStage3IssueCount = results.reduce((sum, result) =>
  sum + (result.stage3Issues as RouteCase['stage3Issues'])
    .reduce((count, item) => count + item.issues.length, 0), 0
)
const mismatches = results.filter(
  result => result.classification === 'mismatch'
)
const candidateProbeDefinitions = [
  {
    path: '/api/v2/content/config',
    legacyStatus: 200,
    databaseStatus: 200,
    legacyContains: '"news":"legacy_git"',
    databaseContains: '"news":"database"'
  },
  {
    path: '/api/v2/content/news',
    legacyStatus: 404,
    databaseStatus: 200,
    databaseContains: '"items"'
  },
  {
    path: '/api/v2/content/wiki',
    legacyStatus: 404,
    databaseStatus: 200,
    databaseContains: '"items"'
  },
  {
    path: '/api/v2/content/members',
    legacyStatus: 404,
    databaseStatus: 200,
    databaseContains: '"items"'
  },
  {
    path: '/api/v2/content/search?q=%E6%9C%BA%E5%99%A8%E4%BA%BA',
    legacyStatus: 404,
    databaseStatus: 200,
    databaseContains: '"items"'
  },
  {
    path: '/sitemap.xml',
    legacyStatus: 404,
    databaseStatus: 200,
    databaseContains: '<urlset'
  },
  {
    path: '/rss.xml',
    legacyStatus: 404,
    databaseStatus: 200,
    databaseContains: '<rss'
  }
] as const
const candidateProbes = await Promise.all(
  candidateProbeDefinitions.map(async (definition) => {
    const [legacyResponse, databaseResponse] = await Promise.all([
      fetch(`${legacyBase}${definition.path}`, { redirect: 'manual' }),
      fetch(`${databaseBase}${definition.path}`, { redirect: 'manual' })
    ])
    const [legacyBody, databaseBody] = await Promise.all([
      legacyResponse.text(),
      databaseResponse.text()
    ])
    const passed = (
      legacyResponse.status === definition.legacyStatus
      && databaseResponse.status === definition.databaseStatus
      && (!('legacyContains' in definition)
        || legacyBody.includes(definition.legacyContains))
      && databaseBody.includes(definition.databaseContains)
    )
    return {
      path: definition.path,
      legacyStatus: legacyResponse.status,
      databaseStatus: databaseResponse.status,
      legacyBodyHash: hashText(legacyBody),
      databaseBodyHash: hashText(databaseBody),
      passed
    }
  })
)
const candidateProbesPassed = candidateProbes.every(probe => probe.passed)
const report = {
  formatVersion: 1,
  scope: {
    phase: 'V2 phase 4',
    legacySource: 'legacy_git + Nuxt Content SSR',
    databaseSource: 'database current_revision + Comark SSR',
    generatedFrom: 'isolated phase4/test HTTP instances',
    productionResourcesTouched: false
  },
  summary: {
    routesCompared: results.length,
    httpSuccessPairs: results.filter(result =>
      (result.legacy as HttpSnapshot).status === 200
      && (result.database as HttpSnapshot).status === 200
    ).length,
    equivalent: results.filter(
      result => result.classification === 'equivalent'
    ).length,
    stage3KnownDifferences: results.filter(
      result => result.classification === 'stage3-known-difference'
    ).length,
    nonCriticalDifferences: results.filter(
      result => result.classification === 'non-critical-difference'
    ).length,
    mismatches: mismatches.length,
    candidateProbes: candidateProbes.length,
    candidateProbesPassed,
    stage3ExpectedFiles: stage3Report.summary.filesWithDifferences,
    stage3MappedFiles: mappedStage3Files.size,
    stage3ExpectedIssues: stage3Report.summary.issueCount,
    stage3MappedIssues: mappedStage3IssueCount
  },
  retention: {
    policy: '单一确定性 JSON 报告；每次阶段 4 对比原位覆盖，不生成时间戳副本',
    temporaryResources: 'HTTP 进程与 phase4/test 数据库在验收命令结束后精确清理'
  },
  candidateProbes,
  results
}

if (shouldWrite) {
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)
}
console.log(JSON.stringify(report.summary, null, 2))
if (
  mismatches.length
  || !candidateProbesPassed
  || mappedStage3Files.size !== stage3Report.summary.filesWithDifferences
  || mappedStage3IssueCount !== stage3Report.summary.issueCount
) {
  process.exitCode = 1
}
