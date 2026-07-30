import { lstat, readFile, readdir, rm } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'

const [rootArgument, project, mode] = process.argv.slice(2)
const dryRun = mode === '--dry-run'
if (!rootArgument || !project) throw new Error('BACKUP_PRUNE_ARGUMENTS_REQUIRED')
const root = resolve(rootArgument)
if (root === '/') throw new Error('BACKUP_PRUNE_ROOT_TOO_BROAD')
const rootStat = await lstat(root)
if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
  throw new Error('BACKUP_PRUNE_ROOT_UNSAFE')
}
if (typeof process.geteuid === 'function' && rootStat.uid !== process.geteuid()) {
  throw new Error('BACKUP_PRUNE_ROOT_OWNER_MISMATCH')
}

const stateRoot = join(root, '.vinci-state')
const stateStat = await lstat(stateRoot)
if (!stateStat.isDirectory() || stateStat.isSymbolicLink()) {
  throw new Error('BACKUP_PRUNE_STATE_UNSAFE')
}
const owner = await readFile(join(stateRoot, 'owner'), 'utf8')
if (!owner.startsWith(`vinci-backup-state-v2\n${project}\n`)) {
  throw new Error('BACKUP_PRUNE_STATE_OWNER_MISMATCH')
}
const latestSuccess = JSON.parse(
  await readFile(join(stateRoot, 'latest-success.json'), 'utf8')
)
if (latestSuccess.status !== 'succeeded') {
  throw new Error('BACKUP_PRUNE_NO_SUCCESSFUL_BACKUP')
}

const inspectTree = async (path) => {
  let bytes = 0
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const target = join(path, entry.name)
    const stat = await lstat(target)
    if (stat.isSymbolicLink()) {
      throw new Error(`BACKUP_PRUNE_SYMLINK:${basename(path)}/${entry.name}`)
    }
    if (typeof process.geteuid === 'function' && stat.uid !== process.geteuid()) {
      throw new Error(`BACKUP_PRUNE_ENTRY_OWNER_MISMATCH:${entry.name}`)
    }
    if (stat.isDirectory()) bytes += await inspectTree(target)
    else if (stat.isFile()) bytes += stat.size
    else throw new Error(`BACKUP_PRUNE_SPECIAL_FILE:${entry.name}`)
  }
  return bytes
}

const optionalMarker = async (path, name) => {
  const stat = await lstat(join(path, name)).catch(() => null)
  if (!stat) return false
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`BACKUP_PRUNE_OPTIONAL_MARKER_UNSAFE:${name}`)
  }
  return true
}

const entries = await readdir(root, { withFileTypes: true })
const pattern = new RegExp(
  `^${project.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d{8}T\\d{6}Z)$`
)
const backups = []
for (const entry of entries) {
  if (entry.name === '.vinci-state') continue
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new Error(`BACKUP_PRUNE_UNEXPECTED_ENTRY:${entry.name}`)
  }
  const match = entry.name.match(pattern)
  if (!match) throw new Error(`BACKUP_PRUNE_UNOWNED_DIRECTORY:${entry.name}`)
  const path = join(root, entry.name)
  const stat = await lstat(path)
  if (typeof process.geteuid === 'function' && stat.uid !== process.geteuid()) {
    throw new Error(`BACKUP_PRUNE_OWNER_MISMATCH:${entry.name}`)
  }
  const markerStat = await lstat(join(path, '.vinci-backup-owner')).catch(() => null)
  if (!markerStat?.isFile() || markerStat.isSymbolicLink()) {
    throw new Error(`BACKUP_PRUNE_MARKER_MISSING:${entry.name}`)
  }
  const marker = await readFile(join(path, '.vinci-backup-owner'), 'utf8')
  if (marker !== `vinci-backup-v2\n${project}\n`) {
    throw new Error(`BACKUP_PRUNE_MARKER_MISMATCH:${entry.name}`)
  }
  const raw = match[1]
  const createdAt = new Date(
    `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T`
    + `${raw.slice(9, 11)}:${raw.slice(11, 13)}:${raw.slice(13, 15)}Z`
  )
  backups.push({
    name: entry.name,
    path,
    createdAt,
    locked: await optionalMarker(path, '.vinci-locked'),
    verified: await optionalMarker(path, '.vinci-verified'),
    bytes: await inspectTree(path)
  })
}
backups.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
if (!backups.some(item => item.name === latestSuccess.path)) {
  throw new Error('BACKUP_PRUNE_LATEST_SUCCESS_MISSING')
}

const dailyDays = Number(process.env.BACKUP_RETENTION_DAILY_DAYS || 7)
const weeklyWeeks = Number(process.env.BACKUP_RETENTION_WEEKLY_WEEKS || 4)
const monthlyMonths = Number(process.env.BACKUP_RETENTION_MONTHLY_MONTHS || 12)
for (const [name, value] of Object.entries({ dailyDays, weeklyWeeks, monthlyMonths })) {
  if (!Number.isInteger(value) || value < 1 || value > 3660) {
    throw new Error(`BACKUP_PRUNE_RETENTION_INVALID:${name}`)
  }
}
const now = process.env.BACKUP_PRUNE_NOW
  ? new Date(process.env.BACKUP_PRUNE_NOW)
  : new Date()
if (Number.isNaN(now.getTime())) throw new Error('BACKUP_PRUNE_NOW_INVALID')

const shanghaiParts = date =>
  Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date).filter(item => item.type !== 'literal')
      .map(item => [item.type, item.value])
  )
const dayKey = (date) => {
  const p = shanghaiParts(date)
  return `${p.year}-${p.month}-${p.day}`
}
const monthKey = date => dayKey(date).slice(0, 7)
const mondayKey = (date) => {
  const shifted = new Date(date.getTime() + 8 * 3600_000)
  const day = shifted.getUTCDay() || 7
  shifted.setUTCDate(shifted.getUTCDate() - day + 1)
  return shifted.toISOString().slice(0, 10)
}

const keep = new Set()
if (backups[0]) keep.add(backups[0].name)
keep.add(latestSuccess.path)
const newestVerified = backups.find(item => item.verified)
if (newestVerified) keep.add(newestVerified.name)
for (const backup of backups) if (backup.locked) keep.add(backup.name)

const dayMs = 24 * 3600_000
const dailyCutoff = now.getTime() - dailyDays * dayMs
const weeklyCutoff = now.getTime() - weeklyWeeks * 7 * dayMs
const monthlyCutoff = new Date(now)
monthlyCutoff.setUTCMonth(monthlyCutoff.getUTCMonth() - monthlyMonths)
const seenDays = new Set()
const seenWeeks = new Set()
const seenMonths = new Set()
for (const backup of backups) {
  const time = backup.createdAt.getTime()
  if (time >= dailyCutoff) {
    const key = dayKey(backup.createdAt)
    if (!seenDays.has(key)) {
      keep.add(backup.name)
      seenDays.add(key)
    }
  } else if (time >= weeklyCutoff) {
    const key = mondayKey(backup.createdAt)
    if (!seenWeeks.has(key)) {
      keep.add(backup.name)
      seenWeeks.add(key)
    }
  } else if (time >= monthlyCutoff.getTime()) {
    const key = monthKey(backup.createdAt)
    if (!seenMonths.has(key)) {
      keep.add(backup.name)
      seenMonths.add(key)
    }
  }
}

const deleteList = backups.filter(item => !keep.has(item.name))
let releasedBytes = 0
for (const backup of deleteList) {
  const rel = relative(root, backup.path)
  if (!rel || rel.startsWith('..') || rel.includes('/')) {
    throw new Error(`BACKUP_PRUNE_PATH_ESCAPE:${backup.name}`)
  }
  releasedBytes += backup.bytes
  if (!dryRun) await rm(backup.path, { recursive: true, force: false })
}
const result = {
  formatVersion: 1,
  dryRun,
  policy: { dailyDays, weeklyWeeks, monthlyMonths },
  protected: [...keep].sort(),
  deleted: deleteList.map(item => item.name),
  releasedBytes
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
