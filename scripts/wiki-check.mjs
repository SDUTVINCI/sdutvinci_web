import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pinyin } from 'pinyin-pro'

const rootDir = process.cwd()
const wikiDir = path.join(rootDir, 'content', 'wiki')
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
