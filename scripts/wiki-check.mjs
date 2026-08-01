import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { pinyin } from 'pinyin-pro'

const requestedSource = String(process.env.WIKI_CHECK_SOURCE || '').trim()
if (!requestedSource) {
  console.error('Wiki 检查需要 WIKI_CHECK_SOURCE 指向独立内容仓库 snapshot 根目录。')
  process.exit(2)
}

const rootDir = path.resolve(requestedSource)
if (rootDir === path.parse(rootDir).root) {
  console.error('WIKI_CHECK_SOURCE 不得是文件系统根目录。')
  process.exit(2)
}
const rootStat = await fs.lstat(rootDir).catch(() => null)
if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
  console.error('WIKI_CHECK_SOURCE 必须是普通目录且不得为符号链接。')
  process.exit(2)
}

const wikiDir = path.join(rootDir, 'wiki')
const files = await collectMarkdownFiles(wikiDir)
const errors = []
const paths = new Map()
const validWikiPaths = new Set(['/wiki'])
const ordersByDoc = new Map()

for (const file of files) {
  const relativePath = path.relative(rootDir, file).replace(/\\/g, '/')
  const docName = path.basename(path.dirname(file))
  const fileName = path.basename(file).replace(/\.(md|mdc)$/i, '')
  const isIndex = fileName === 'index'
  const chapterOrder = fileName.match(/^(\d{4}(?:-\d{4})*)-/)?.[1]
  const docSlug = toPinyinSlug(docName)
  const pageSlug = isIndex ? '' : toPinyinSlug(fileName)
  const pagePath = `/${['wiki', docSlug, pageSlug].filter(Boolean).join('/')}`

  if (!isIndex && !chapterOrder) {
    errors.push(`${relativePath}: 章节文件名必须以四位 order 开头`)
  }

  const existingPath = paths.get(pagePath)
  if (existingPath) {
    errors.push(`${relativePath}: URL 与 ${existingPath} 冲突 (${pagePath})`)
  } else {
    paths.set(pagePath, relativePath)
    validWikiPaths.add(pagePath)
  }

  if (chapterOrder) {
    const docOrders = ordersByDoc.get(docSlug) || new Map()
    const existingOrder = docOrders.get(chapterOrder)

    if (existingOrder) {
      errors.push(`${relativePath}: order ${chapterOrder} 与 ${existingOrder} 重复`)
    } else {
      docOrders.set(chapterOrder, relativePath)
      ordersByDoc.set(docSlug, docOrders)
    }
  }

  if (fileName.startsWith('ch')) {
    errors.push(`${relativePath}: 仍在使用旧 ch 章节前缀`)
  }
}

await validateSnapshotAndManifest()

for (const file of files) {
  const source = await fs.readFile(file, 'utf8')
  const relativePath = path.relative(rootDir, file).replace(/\\/g, '/')
  const legacyLinks = source.match(/\/wiki\/[^)\s"'<>]+\/ch\d+(?:-\d+)*-[^)\s"'<>#]+/gi) || []

  for (const link of legacyLinks) {
    errors.push(`${relativePath}: 仍引用旧章节链接 ${link}`)
  }

  const wikiLinks = source.matchAll(/(?<![A-Za-z0-9.])\/wiki\/[^\s"'<>)]*/g)

  for (const match of wikiLinks) {
    const rawLink = match[0].replace(/[.,;:，。；：]+$/, '')
    const linkPath = rawLink.split(/[?#]/)[0].replace(/\/+$/, '')

    if (linkPath && !validWikiPaths.has(linkPath)) {
      errors.push(`${relativePath}: Wiki 链接不存在 ${rawLink}`)
    }
  }
}

if (errors.length) {
  console.error(`Wiki 检查失败，共 ${errors.length} 个问题：`)
  errors.forEach(error => console.error(`- ${error}`))
  process.exitCode = 1
} else {
  console.log(`Wiki 检查通过：${files.length} 个文件，order、URL 与站内链接均正常。`)
}

async function collectMarkdownFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const result = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      result.push(...await collectMarkdownFiles(fullPath))
    } else if (entry.isFile() && /\.mdc?$/i.test(entry.name)) {
      result.push(fullPath)
    }
  }

  return result
}

function toPinyinSlug(value) {
  const converted = pinyin(value.replace(/^\d+\./, ''), {
    toneType: 'none',
    type: 'array',
    nonZh: 'consecutive'
  }).join('-')

  return converted
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function validateSnapshotAndManifest() {
  const snapshotPath = path.join(rootDir, '.vinci', 'snapshot.json')
  const manifestPath = path.join(rootDir, 'manifest.json')
  const [snapshotSource, manifestSource] = await Promise.all([
    fs.readFile(snapshotPath, 'utf8'),
    fs.readFile(manifestPath, 'utf8')
  ]).catch(() => {
    errors.push('独立内容仓库缺少 .vinci/snapshot.json 或 manifest.json')
    return [null, null]
  })
  if (!snapshotSource || !manifestSource) return

  let snapshot
  let manifest
  try {
    snapshot = JSON.parse(snapshotSource)
    manifest = JSON.parse(manifestSource)
  } catch {
    errors.push('snapshot 或 manifest 不是有效 JSON')
    return
  }

  const snapshotWiki = Array.isArray(snapshot.files)
    ? snapshot.files.filter(item => item?.collection === 'wiki')
    : []
  const snapshotByPath = new Map(snapshotWiki.map(item => [item.path, item]))
  const manifestByPath = new Map(
    (Array.isArray(manifest.files) ? manifest.files : []).map(item => [item.path, item])
  )
  const actualPaths = files.map(file => path.relative(rootDir, file).replace(/\\/g, '/')).sort()

  if (snapshotByPath.size !== actualPaths.length) {
    errors.push(`snapshot Wiki 条目数 ${snapshotByPath.size} 与文件数 ${actualPaths.length} 不一致`)
  }

  for (const gitPath of actualPaths) {
    const source = await fs.readFile(path.join(rootDir, gitPath))
    const sha256 = createHash('sha256').update(source).digest('hex')
    const snapshotItem = snapshotByPath.get(gitPath)
    const manifestItem = manifestByPath.get(gitPath)
    if (!snapshotItem) {
      errors.push(`${gitPath}: 不在 snapshot 中`)
      continue
    }
    if (snapshotItem.sha256 !== sha256 || snapshotItem.bytes !== source.byteLength) {
      errors.push(`${gitPath}: snapshot SHA-256 或字节数不匹配`)
    }
    if (manifestItem?.sha256 !== sha256 || manifestItem?.bytes !== source.byteLength) {
      errors.push(`${gitPath}: manifest SHA-256 或字节数不匹配`)
    }
  }
}
