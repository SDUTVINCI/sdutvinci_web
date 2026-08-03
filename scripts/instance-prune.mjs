import { lstat, readFile, readdir, rm } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

const [rootArgument, project, mode] = process.argv.slice(2)
if (!rootArgument || !project) throw new Error('INSTANCE_PRUNE_ARGUMENTS_REQUIRED')
const dryRun = mode === '--dry-run'
const root = resolve(rootArgument)
if (root === '/') throw new Error('INSTANCE_PRUNE_ROOT_TOO_BROAD')
const rootStat = await lstat(root)
if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
  throw new Error('INSTANCE_PRUNE_ROOT_UNSAFE')
}
if (typeof process.geteuid === 'function' && rootStat.uid !== process.geteuid()) {
  throw new Error('INSTANCE_PRUNE_ROOT_OWNER_MISMATCH')
}
const retentionDays = Number(process.env.INSTANCE_RETENTION_DAYS || 30)
if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3660) {
  throw new Error('INSTANCE_PRUNE_RETENTION_INVALID')
}
const now = process.env.INSTANCE_PRUNE_NOW ? new Date(process.env.INSTANCE_PRUNE_NOW) : new Date()
if (Number.isNaN(now.getTime())) throw new Error('INSTANCE_PRUNE_NOW_INVALID')
const cutoff = now.getTime() - retentionDays * 86400_000
const pattern = new RegExp(`^${project.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-instance-(\\d{8}T\\d{6}Z)$`)
const deleted = []
const protectedItems = []
const entries = await readdir(root, { withFileTypes: true })
const markerName = '.vinci-instance-root'
const markerPath = join(root, markerName)
const markerStat = await lstat(markerPath).catch((error) => {
  if (error.code === 'ENOENT') return null
  throw error
})
if (!markerStat) {
  if (entries.length > 0) {
    throw new Error('INSTANCE_PRUNE_ROOT_MARKER_MISSING_NONEMPTY')
  }
  process.stdout.write(`${JSON.stringify({
    formatVersion: 1,
    dryRun,
    retentionDays,
    state: 'uninitialized_empty',
    protected: [],
    deleted: []
  }, null, 2)}\n`)
  process.exit(0)
}
if (
  !markerStat.isFile()
  || markerStat.isSymbolicLink()
  || (typeof process.geteuid === 'function' && markerStat.uid !== process.geteuid())
) {
  throw new Error('INSTANCE_PRUNE_ROOT_MARKER_UNSAFE')
}
const marker = await readFile(markerPath, 'utf8')
if (marker !== `vinci-instance-root-v1\n${project}\n`) {
  throw new Error('INSTANCE_PRUNE_ROOT_MARKER_MISMATCH')
}
for (const entry of entries) {
  if (entry.name === markerName) continue
  const match = entry.name.match(pattern)
  if (!match || !entry.isDirectory() || entry.isSymbolicLink()) {
    throw new Error(`INSTANCE_PRUNE_UNOWNED:${entry.name}`)
  }
  const path = join(root, entry.name)
  const stat = await lstat(path)
  if (typeof process.geteuid === 'function' && stat.uid !== process.geteuid()) {
    throw new Error(`INSTANCE_PRUNE_OWNER_MISMATCH:${entry.name}`)
  }
  const owner = await readFile(join(path, '.vinci-instance-owner'), 'utf8')
  if (owner !== `vinci-instance-v1\n${project}\n`) {
    throw new Error(`INSTANCE_PRUNE_MARKER_MISMATCH:${entry.name}`)
  }
  const locked = await lstat(join(path, '.vinci-locked')).catch(() => null)
  if (locked) {
    if (!locked.isFile() || locked.isSymbolicLink()) throw new Error(`INSTANCE_PRUNE_LOCK_UNSAFE:${entry.name}`)
    protectedItems.push(entry.name)
    continue
  }
  if (stat.mtimeMs >= cutoff) {
    protectedItems.push(entry.name)
    continue
  }
  const rel = relative(root, path)
  if (!rel || rel.startsWith('..') || rel.includes('/')) throw new Error(`INSTANCE_PRUNE_ESCAPE:${entry.name}`)
  deleted.push(entry.name)
  if (!dryRun) await rm(path, { recursive: true, force: false })
}
process.stdout.write(`${JSON.stringify({
  formatVersion: 1,
  dryRun,
  retentionDays,
  protected: protectedItems.sort(),
  deleted: deleted.sort()
}, null, 2)}\n`)
