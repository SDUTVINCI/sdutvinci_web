import { mkdir, realpath, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'

export type CmsContentArea = 'members' | 'news' | 'wiki'

const contentRoot = () => resolve(process.env.CMS_CONTENT_ROOT || resolve(process.cwd(), 'content'))
const areaRoot = (area: CmsContentArea) => resolve(contentRoot(), area)

const assertRelativePath = (value: string) => {
  if (!value || isAbsolute(value) || value.includes('\0')) {
    throw new Error('CONTENT_PATH_OUTSIDE_ROOT')
  }
  const normalized = value.replaceAll('\\', '/')
  if (normalized.split('/').includes('..')) {
    throw new Error('CONTENT_PATH_OUTSIDE_ROOT')
  }
  return normalized
}

const isInside = (root: string, target: string) => {
  const pathFromRoot = relative(root, target)
  return pathFromRoot === '' || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot))
}

export const resolveExistingContentFile = async (
  area: CmsContentArea,
  pathWithinArea: string
) => {
  const safeRelative = assertRelativePath(pathWithinArea)
  const root = await realpath(areaRoot(area))
  const target = await realpath(resolve(root, safeRelative))
  if (!isInside(root, target) || extname(target).toLowerCase() !== '.md') {
    throw new Error('CONTENT_PATH_OUTSIDE_ROOT')
  }
  return target
}

export const listMarkdownFiles = async (area: CmsContentArea) => {
  const root = await realpath(areaRoot(area))
  const files: string[] = []

  const visit = async (directory: string) => {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))) {
      const target = resolve(directory, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) await visit(target)
      if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') {
        files.push(relative(root, target).split(sep).join('/'))
      }
    }
  }

  await visit(root)
  return files
}

export const readContentFile = async (area: CmsContentArea, pathWithinArea: string) => {
  const path = await resolveExistingContentFile(area, pathWithinArea)
  const statLimit = 4 * 1024 * 1024
  const source = await readFile(path, 'utf8')
  if (Buffer.byteLength(source) > statLimit) {
    throw new Error('CONTENT_FILE_TOO_LARGE')
  }
  return { path, source }
}

export const writeContentFileAtomically = async (
  area: CmsContentArea,
  pathWithinArea: string,
  source: string
) => {
  const target = await resolveExistingContentFile(area, pathWithinArea)
  const temp = resolve(dirname(target), `.${randomUUID()}.tmp`)
  try {
    await writeFile(temp, source, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await rename(temp, target)
  } finally {
    await unlink(temp).catch(() => undefined)
  }
}

export const createContentFile = async (
  area: CmsContentArea,
  pathWithinArea: string,
  source: string
) => {
  const safeRelative = assertRelativePath(pathWithinArea)
  const root = await realpath(areaRoot(area))
  const target = resolve(root, safeRelative)
  if (!isInside(root, target) || extname(target).toLowerCase() !== '.md') {
    throw new Error('CONTENT_PATH_OUTSIDE_ROOT')
  }
  const parent = dirname(target)
  await mkdir(parent, { recursive: true })
  const realParent = await realpath(parent)
  if (!isInside(root, realParent)) {
    throw new Error('CONTENT_PATH_OUTSIDE_ROOT')
  }
  await writeFile(target, source, { encoding: 'utf8', flag: 'wx', mode: 0o644 })
}
