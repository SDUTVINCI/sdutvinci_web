#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { remark } from 'remark'
import { parseDocument } from 'yaml'

const repositoryRoot = resolve(import.meta.dirname, '..')
const contentRoot = resolve(repositoryRoot, 'content')
const collections = ['members', 'news', 'wiki']
const frontmatterPattern = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

const operationalScopes = [
  '.env.example',
  '.github/',
  'Dockerfile',
  'compose.yaml',
  'docker/',
  'docs/CODEX_HANDOVER.md',
  'docs/DEPLOYMENT.md',
  'scripts/',
  'systemd/',
  'tests/'
]

const excludedOperationalFiles = new Set([
  'scripts/v2-phase0-audit.mjs'
])

const dependencyPatterns = {
  dedicatedUser: /\bvinci-deploy\b/g,
  dedicatedHome: /\/home\/vinci-deploy\b/g,
  sudoUserSwitch: /sudo\s+(?:-u|-iu)\s+vinci-deploy\b/g,
  systemdIdentity: /^(?:User|Group)=vinci-deploy\b/gm,
  fixedRepositoryRoot: /\/opt\/vinci-cms\b/g,
  fixedBackupRoot: /\/var\/backups\/vinci-cms\b/g,
  maintainerSpecificUser: /\btungchiahui\b/g,
  absoluteHomePath: /\/home\/[A-Za-z0-9._-]+/g
}

const htmlElements = new Set([
  'a', 'abbr', 'address', 'area', 'article', 'aside', 'audio', 'b', 'base',
  'bdi', 'bdo', 'blockquote', 'body', 'br', 'button', 'canvas', 'caption',
  'cite', 'code', 'col', 'colgroup', 'data', 'datalist', 'dd', 'del',
  'details', 'dfn', 'dialog', 'div', 'dl', 'dt', 'em', 'embed', 'fieldset',
  'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5',
  'h6', 'head', 'header', 'hgroup', 'hr', 'html', 'i', 'iframe', 'img',
  'input', 'ins', 'kbd', 'label', 'legend', 'li', 'link', 'main', 'map',
  'mark', 'menu', 'meta', 'meter', 'nav', 'noscript', 'object', 'ol',
  'optgroup', 'option', 'output', 'p', 'picture', 'pre', 'progress', 'q',
  'rp', 'rt', 'ruby', 's', 'samp', 'script', 'search', 'section', 'select',
  'slot', 'small', 'source', 'span', 'strong', 'style', 'sub', 'summary',
  'sup', 'table', 'tbody', 'td', 'template', 'textarea', 'tfoot', 'th',
  'thead', 'time', 'title', 'tr', 'track', 'u', 'ul', 'var', 'video', 'wbr'
])

const posixPath = path => path.split(sep).join('/')

const valueType = (value) => {
  if (value === null) return 'null'
  if (Array.isArray(value)) {
    const elementTypes = [...new Set(value.map(valueType))].sort()
    return `array<${elementTypes.join('|') || 'empty'}>`
  }
  if (value instanceof Date) return 'date'
  return typeof value
}

const increment = (record, key, amount = 1) => {
  record[key] = (record[key] || 0) + amount
}

const matchCount = (value, pattern) => [...value.matchAll(pattern)].length

const listFiles = async (root) => {
  const paths = []

  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0
    )
    for (const entry of entries) {
      const absolutePath = resolve(directory, entry.name)
      if (entry.isSymbolicLink()) {
        paths.push({ absolutePath, type: 'symlink' })
      } else if (entry.isDirectory()) {
        await visit(absolutePath)
      } else if (entry.isFile()) {
        paths.push({ absolutePath, type: 'file' })
      }
    }
  }

  await visit(root)
  return paths
}

const walkAst = (node, visit) => {
  visit(node)
  if (Array.isArray(node.children)) {
    for (const child of node.children) walkAst(child, visit)
  }
}

const parseFrontmatter = (source) => {
  const match = source.match(frontmatterPattern)
  if (!match) return { frontmatter: {}, body: source, present: false }

  const yamlSource = match[1].replace(/^(\t+)/gm, tabs => '  '.repeat(tabs.length))
  const document = parseDocument(yamlSource, {
    prettyErrors: true,
    strict: false
  })
  if (document.errors.length) {
    throw new Error(document.errors[0].message)
  }
  const value = document.toJS({ maxAliasCount: 50 })
  return {
    frontmatter: value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : {},
    body: source.slice(match[0].length),
    present: true
  }
}

const collectContentInventory = async () => {
  const entries = await listFiles(contentRoot)
  const markdownEntries = entries.filter(entry =>
    entry.type === 'file' && entry.absolutePath.toLowerCase().endsWith('.md')
  )
  const symlinks = entries
    .filter(entry => entry.type === 'symlink')
    .map(entry => posixPath(relative(repositoryRoot, entry.absolutePath)))
    .sort()

  const counts = Object.fromEntries(collections.map(collection => [collection, 0]))
  const bytes = Object.fromEntries(collections.map(collection => [collection, 0]))
  const paths = Object.fromEntries(collections.map(collection => [collection, []]))
  const frontmatterFields = {}
  const frontmatter = {
    filesWithFrontmatter: 0,
    filesWithoutFrontmatter: 0,
    parseErrors: []
  }
  const syntax = {
    nuxtLink: { occurrences: 0, files: [] },
    mdcDirectives: { occurrences: 0, files: [] },
    jekyllIncludes: { occurrences: 0, files: [] },
    otherTemplateTokens: { occurrences: 0, files: [] },
    html: { nodes: 0, files: [], tags: {} },
    vueOrCustomElements: { occurrences: 0, files: [], tags: {} }
  }
  const manifestHash = createHash('sha256')
  let largestFile = { path: '', bytes: 0 }

  for (const entry of markdownEntries) {
    const repositoryPath = posixPath(relative(repositoryRoot, entry.absolutePath))
    const [, collection] = repositoryPath.split('/')
    if (!collections.includes(collection)) continue

    const source = await readFile(entry.absolutePath, 'utf8')
    const sourceBytes = Buffer.byteLength(source)
    const fileHash = createHash('sha256').update(source).digest('hex')
    counts[collection] += 1
    bytes[collection] += sourceBytes
    paths[collection].push(repositoryPath)
    manifestHash.update(repositoryPath).update('\0').update(fileHash).update('\n')
    if (sourceBytes > largestFile.bytes) {
      largestFile = { path: repositoryPath, bytes: sourceBytes }
    }

    let parsed
    try {
      parsed = parseFrontmatter(source)
    } catch (error) {
      frontmatter.parseErrors.push({
        path: repositoryPath,
        message: error instanceof Error ? error.message : String(error)
      })
      parsed = { frontmatter: {}, body: source, present: false }
    }

    if (parsed.present) frontmatter.filesWithFrontmatter += 1
    else frontmatter.filesWithoutFrontmatter += 1

    for (const [field, value] of Object.entries(parsed.frontmatter)) {
      const fieldRecord = frontmatterFields[field] ||= {
        files: 0,
        collections: {},
        types: {}
      }
      fieldRecord.files += 1
      increment(fieldRecord.collections, collection)
      increment(fieldRecord.types, valueType(value))
    }

    const ast = remark().parse(parsed.body)
    let htmlNodes = 0
    let mdcOccurrences = 0
    const htmlTagsInFile = {}
    const customTagsInFile = {}
    walkAst(ast, (node) => {
      if (node.type === 'html' && typeof node.value === 'string') {
        htmlNodes += 1
        for (const match of node.value.matchAll(/<\/?([A-Za-z][A-Za-z0-9:-]*)\b/g)) {
          const tag = match[1]
          const normalized = tag.toLowerCase()
          if (htmlElements.has(normalized)) increment(htmlTagsInFile, normalized)
          else increment(customTagsInFile, tag)
        }
      }
      if (node.type === 'text' && typeof node.value === 'string') {
        mdcOccurrences += matchCount(
          node.value,
          /(?:^|\n)\s*:{1,3}[A-Za-z][A-Za-z0-9_-]*(?:\{[^}\n]*\})?/g
        )
      }
    })

    const nuxtLinkOccurrences = matchCount(parsed.body, /<NuxtLink\b/g)
    const includeOccurrences = matchCount(parsed.body, /\{%\s*include\b[^%]*%\}/g)
    const allTemplateOccurrences = matchCount(
      parsed.body,
      /\{%(?!\s*include\b)[\s\S]*?%\}|\{\{[\s\S]*?\}\}|\{#[\s\S]*?#\}/g
    )

    if (nuxtLinkOccurrences) {
      syntax.nuxtLink.occurrences += nuxtLinkOccurrences
      syntax.nuxtLink.files.push(repositoryPath)
    }
    if (mdcOccurrences) {
      syntax.mdcDirectives.occurrences += mdcOccurrences
      syntax.mdcDirectives.files.push(repositoryPath)
    }
    if (includeOccurrences) {
      syntax.jekyllIncludes.occurrences += includeOccurrences
      syntax.jekyllIncludes.files.push(repositoryPath)
    }
    if (allTemplateOccurrences) {
      syntax.otherTemplateTokens.occurrences += allTemplateOccurrences
      syntax.otherTemplateTokens.files.push(repositoryPath)
    }
    if (htmlNodes) {
      syntax.html.nodes += htmlNodes
      syntax.html.files.push(repositoryPath)
      for (const [tag, count] of Object.entries(htmlTagsInFile)) {
        increment(syntax.html.tags, tag, count)
      }
    }
    const customOccurrenceCount = Object.values(customTagsInFile)
      .reduce((total, count) => total + count, 0)
    if (customOccurrenceCount) {
      syntax.vueOrCustomElements.occurrences += customOccurrenceCount
      syntax.vueOrCustomElements.files.push(repositoryPath)
      for (const [tag, count] of Object.entries(customTagsInFile)) {
        increment(syntax.vueOrCustomElements.tags, tag, count)
      }
    }
  }

  for (const collection of collections) paths[collection].sort()
  frontmatter.parseErrors.sort((left, right) => left.path.localeCompare(right.path))
  for (const record of Object.values(frontmatterFields)) {
    record.collections = Object.fromEntries(Object.entries(record.collections).sort())
    record.types = Object.fromEntries(Object.entries(record.types).sort())
  }
  for (const record of Object.values(syntax)) {
    if (Array.isArray(record.files)) record.files.sort()
    if (record.tags) record.tags = Object.fromEntries(Object.entries(record.tags).sort())
  }

  return {
    collections: {
      members: { files: counts.members, bytes: bytes.members, paths: paths.members },
      news: { files: counts.news, bytes: bytes.news, paths: paths.news },
      wiki: { files: counts.wiki, bytes: bytes.wiki, paths: paths.wiki }
    },
    totals: {
      markdownFiles: markdownEntries.length,
      bytes: Object.values(bytes).reduce((total, value) => total + value, 0),
      symlinks: symlinks.length,
      largestFile,
      byteManifestSha256: manifestHash.digest('hex')
    },
    symlinkPaths: symlinks,
    frontmatter: {
      ...frontmatter,
      fields: Object.fromEntries(Object.entries(frontmatterFields).sort())
    },
    syntax
  }
}

const trackedFiles = () => execFileSync(
  'git',
  ['ls-files', '-z'],
  { cwd: repositoryRoot, encoding: 'utf8' }
).split('\0').filter(Boolean).sort()

const isOperationalFile = path =>
  !excludedOperationalFiles.has(path)
  && operationalScopes.some(scope => scope.endsWith('/') ? path.startsWith(scope) : path === scope)

const operationalCategory = (path) => {
  if (path.startsWith('tests/')) return 'test'
  if (path.startsWith('docs/')) return 'documentation'
  return 'active'
}

const lineNumberAt = (source, offset) =>
  source.slice(0, offset).split('\n').length

const collectDeploymentInventory = async () => {
  const references = Object.fromEntries(
    Object.keys(dependencyPatterns).map(name => [name, []])
  )
  const files = trackedFiles().filter(isOperationalFile)

  for (const path of files) {
    const source = await readFile(resolve(repositoryRoot, path), 'utf8')
    for (const [name, pattern] of Object.entries(dependencyPatterns)) {
      for (const match of source.matchAll(pattern)) {
        references[name].push({
          path,
          line: lineNumberAt(source, match.index),
          category: operationalCategory(path),
          value: match[0]
        })
      }
    }
  }

  return {
    scannedTrackedFiles: files.length,
    patterns: Object.fromEntries(
      Object.entries(references).map(([name, matches]) => [
        name,
        {
          occurrences: matches.length,
          files: [...new Set(matches.map(match => match.path))].sort(),
          references: matches
        }
      ])
    )
  }
}

const contentInventory = await collectContentInventory()
const deploymentInventory = await collectDeploymentInventory()

if (process.argv.includes('--check')) {
  const failures = []
  if (contentInventory.totals.markdownFiles === 0) failures.push('没有找到 Markdown')
  if (contentInventory.totals.symlinks !== 0) failures.push('content/ 含符号链接')
  if (contentInventory.frontmatter.parseErrors.length !== 0) failures.push('存在 Frontmatter 解析错误')
  if (failures.length) {
    throw new Error(`V2 阶段 0 盘点失败：${failures.join('；')}`)
  }
}

process.stdout.write(`${JSON.stringify({
  formatVersion: 1,
  content: contentInventory,
  deployment: deploymentInventory
}, null, 2)}\n`)
