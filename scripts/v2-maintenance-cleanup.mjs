import { lstat, readFile, readdir, rm } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

const [rootArgument, mode] = process.argv.slice(2)
if (!rootArgument) throw new Error('MAINTENANCE_CLEANUP_ROOT_REQUIRED')
const dryRun = mode === '--dry-run'
const root = resolve(rootArgument)
if (root === '/') throw new Error('MAINTENANCE_CLEANUP_ROOT_TOO_BROAD')
const rootStat = await lstat(root)
if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
  throw new Error('MAINTENANCE_CLEANUP_ROOT_UNSAFE')
}
if (typeof process.geteuid === 'function' && rootStat.uid !== process.geteuid()) {
  throw new Error('MAINTENANCE_CLEANUP_ROOT_OWNER_MISMATCH')
}
if (await readFile(join(root, '.vinci-phase7-owner'), 'utf8')
  !== 'vinci-content-reconciliation-root-v1\n') {
  throw new Error('MAINTENANCE_CLEANUP_ROOT_UNOWNED')
}

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const categories = [
  {
    name: 'snapshots',
    maxAgeDays: Number(process.env.CONTENT_SNAPSHOT_RETENTION_DAYS || 30),
    pattern: new RegExp(`^${uuid}$`),
    type: 'directory',
    marker: '.vinci-owner'
  },
  {
    name: 'reports',
    maxAgeDays: Number(process.env.RECONCILIATION_REPORT_RETENTION_DAYS || 90),
    pattern: new RegExp(`^${uuid}\\.json$`),
    type: 'file'
  },
  {
    name: 'tmp',
    maxAgeDays: Number(process.env.RECONCILIATION_TEMP_RETENTION_DAYS || 1),
    pattern: new RegExp(`^${uuid}\\.snapshot$`),
    type: 'directory',
    marker: '.vinci-owner'
  }
]
for (const category of categories) {
  if (!Number.isInteger(category.maxAgeDays) || category.maxAgeDays < 1) {
    throw new Error(`MAINTENANCE_CLEANUP_RETENTION_INVALID:${category.name}`)
  }
}
const now = process.env.MAINTENANCE_CLEANUP_NOW
  ? new Date(process.env.MAINTENANCE_CLEANUP_NOW)
  : new Date()
if (Number.isNaN(now.getTime())) throw new Error('MAINTENANCE_CLEANUP_NOW_INVALID')

const assertSafeTree = async (directory, label) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name)
    const stat = await lstat(target)
    if (stat.isSymbolicLink()) {
      throw new Error(`MAINTENANCE_CLEANUP_SYMLINK:${label}/${entry.name}`)
    }
    if (
      typeof process.geteuid === 'function'
      && stat.uid !== process.geteuid()
    ) {
      throw new Error(`MAINTENANCE_CLEANUP_OWNER_MISMATCH:${label}/${entry.name}`)
    }
    if (stat.isDirectory()) await assertSafeTree(target, `${label}/${entry.name}`)
    else if (!stat.isFile()) {
      throw new Error(`MAINTENANCE_CLEANUP_SPECIAL_FILE:${label}/${entry.name}`)
    }
  }
}

const deleted = []
const protectedItems = []
for (const category of categories) {
  const directory = join(root, category.name)
  const stat = await lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`MAINTENANCE_CLEANUP_CATEGORY_UNSAFE:${category.name}`)
  }
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name)
    const targetStat = await lstat(target)
    if (targetStat.isSymbolicLink()) {
      throw new Error(`MAINTENANCE_CLEANUP_SYMLINK:${category.name}/${entry.name}`)
    }
    if (
      typeof process.geteuid === 'function'
      && targetStat.uid !== process.geteuid()
    ) {
      throw new Error(`MAINTENANCE_CLEANUP_OWNER_MISMATCH:${category.name}/${entry.name}`)
    }
    if (!category.pattern.test(entry.name)) {
      throw new Error(`MAINTENANCE_CLEANUP_UNOWNED:${category.name}/${entry.name}`)
    }
    if (
      (category.type === 'directory' && !targetStat.isDirectory())
      || (category.type === 'file' && !targetStat.isFile())
    ) {
      throw new Error(`MAINTENANCE_CLEANUP_TYPE_MISMATCH:${category.name}/${entry.name}`)
    }
    if (category.marker) {
      const marker = join(target, category.marker)
      const markerStat = await lstat(marker).catch(() => null)
      if (!markerStat?.isFile() || markerStat.isSymbolicLink()) {
        throw new Error(`MAINTENANCE_CLEANUP_MARKER_MISSING:${category.name}/${entry.name}`)
      }
      const expectedId = entry.name.replace(/\.snapshot$/, '')
      if (await readFile(marker, 'utf8') !== `${expectedId}\n`) {
        throw new Error(`MAINTENANCE_CLEANUP_MARKER_MISMATCH:${category.name}/${entry.name}`)
      }
      await assertSafeTree(target, `${category.name}/${entry.name}`)
    }
    const cutoff = now.getTime() - category.maxAgeDays * 24 * 3600_000
    const record = `${category.name}/${entry.name}`
    if (targetStat.mtimeMs >= cutoff) {
      protectedItems.push(record)
      continue
    }
    const rel = relative(root, target)
    if (!rel || rel.startsWith('..')) {
      throw new Error(`MAINTENANCE_CLEANUP_PATH_ESCAPE:${record}`)
    }
    deleted.push(record)
    if (!dryRun) {
      await rm(target, {
        recursive: category.type === 'directory',
        force: false
      })
    }
  }
}
process.stdout.write(`${JSON.stringify({
  formatVersion: 1,
  dryRun,
  deleted: deleted.sort(),
  protected: protectedItems.sort()
}, null, 2)}\n`)
