import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { parseCmsMarkdown } from '../utils/cms-frontmatter'
import {
  buildContentRepositoryMetadata,
  serializeContentRevision,
  sha256ContentBytes,
  type ContentSnapshotFile,
  type ContentSnapshotMember
} from './content-export-serialization'
import { memberProfileFromMarkdown, serializeMemberProfile } from './member-profile'

const execFileAsync = promisify(execFile)
const expectedAreas = new Set(['news', 'wiki', 'members'])
const maximumMarkdownBytes = 4 * 1024 * 1024

const git = async (root: string, args: string[]) => {
  const { stdout } = await execFileAsync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024
  })
  return stdout.trim()
}

const isInside = (root: string, target: string) => {
  const fromRoot = relative(root, target)
  return fromRoot === '' || (
    fromRoot !== '..'
    && !fromRoot.startsWith(`..${sep}`)
    && !isAbsolute(fromRoot)
  )
}

const deterministicUuid = (sourceCommit: string, purpose: string, path: string) => {
  const bytes = createHash('sha256')
    .update(`vinci-initial-content\0${sourceCommit}\0${purpose}\0${path}`)
    .digest()
    .subarray(0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const writePrivateFile = async (root: string, path: string, source: string) => {
  const target = resolve(root, path)
  if (!isInside(root, target) || target === root) {
    throw new Error('INITIAL_CONTENT_OUTPUT_PATH_ESCAPE')
  }
  await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  await writeFile(target, source, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
}

export interface PrepareInitialContentSnapshotInput {
  sourceRoot: string
  outputRoot: string
  sourceCommit: string
  expectedRemote: string
  expectedBranch?: string
}

export interface InitialContentSnapshotReport {
  formatVersion: 1
  sourceCommit: string
  sourceRemote: string
  sourceBranch: string
  articleCount: number
  memberCount: number
  snapshotSha256: string
  manifestSha256: string
  outputRoot: string
}

export const prepareInitialContentSnapshot = async (
  input: PrepareInitialContentSnapshotInput
): Promise<InitialContentSnapshotReport> => {
  const sourceRoot = resolve(input.sourceRoot)
  const outputRoot = resolve(input.outputRoot)
  const expectedBranch = input.expectedBranch || 'main'
  if (!isAbsolute(input.sourceRoot) || !isAbsolute(input.outputRoot)) {
    throw new Error('INITIAL_CONTENT_PATH_NOT_ABSOLUTE')
  }
  if (!/^[0-9a-f]{40}$/.test(input.sourceCommit)) {
    throw new Error('INITIAL_CONTENT_COMMIT_INVALID')
  }
  if (!input.expectedRemote.trim()) throw new Error('INITIAL_CONTENT_REMOTE_REQUIRED')
  if (sourceRoot === outputRoot || isInside(sourceRoot, outputRoot) || isInside(outputRoot, sourceRoot)) {
    throw new Error('INITIAL_CONTENT_SOURCE_OUTPUT_OVERLAP')
  }

  const sourceStat = await lstat(sourceRoot)
  const gitStat = await lstat(join(sourceRoot, '.git'))
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()
    || !gitStat.isDirectory() || gitStat.isSymbolicLink()) {
    throw new Error('INITIAL_CONTENT_SOURCE_UNSAFE')
  }
  if (await git(sourceRoot, ['status', '--porcelain=v1', '--untracked-files=all'])) {
    throw new Error('INITIAL_CONTENT_SOURCE_DIRTY')
  }
  const [commit, remote, branch, trackingCommit] = await Promise.all([
    git(sourceRoot, ['rev-parse', 'HEAD']),
    git(sourceRoot, ['remote', 'get-url', 'origin']),
    git(sourceRoot, ['branch', '--show-current']),
    git(sourceRoot, ['rev-parse', `refs/remotes/origin/${expectedBranch}`])
  ])
  if (commit !== input.sourceCommit || trackingCommit !== input.sourceCommit) {
    throw new Error('INITIAL_CONTENT_COMMIT_MISMATCH')
  }
  if (remote !== input.expectedRemote) throw new Error('INITIAL_CONTENT_REMOTE_MISMATCH')
  if (branch !== expectedBranch) throw new Error('INITIAL_CONTENT_BRANCH_MISMATCH')

  const tracked = (await git(sourceRoot, ['ls-files', '-z']))
    .split('\0')
    .filter(Boolean)
    .sort()
  if (!tracked.length) throw new Error('INITIAL_CONTENT_SOURCE_EMPTY')
  for (const path of tracked) {
    const segments = path.split('/')
    if (segments.length < 3 || segments[0] !== 'content'
      || !expectedAreas.has(segments[1]!) || !path.endsWith('.md')
      || segments.some(segment => !segment || segment === '.' || segment === '..')) {
      throw new Error(`INITIAL_CONTENT_TRACKED_PATH_INVALID:${path}`)
    }
    const stat = await lstat(resolve(sourceRoot, path))
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximumMarkdownBytes) {
      throw new Error(`INITIAL_CONTENT_TRACKED_FILE_UNSAFE:${path}`)
    }
  }

  const generatedAtSource = await git(sourceRoot, ['show', '-s', '--format=%cI', input.sourceCommit])
  const generatedAt = new Date(generatedAtSource)
  if (Number.isNaN(generatedAt.getTime())) throw new Error('INITIAL_CONTENT_COMMIT_TIME_INVALID')

  const outputParent = dirname(outputRoot)
  const outputName = basename(outputRoot)
  const parentStat = await lstat(outputParent)
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || !outputName || outputName === '.') {
    throw new Error('INITIAL_CONTENT_OUTPUT_PARENT_UNSAFE')
  }
  try {
    await lstat(outputRoot)
    throw new Error('INITIAL_CONTENT_OUTPUT_EXISTS')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  const temporary = await mkdtemp(join(outputParent, '.vinci-initial-snapshot-'))
  const files: ContentSnapshotFile[] = []
  const members: ContentSnapshotMember[] = []
  const memberKeys = new Set<string>()
  try {
    for (const trackedPath of tracked) {
      const source = await readFile(resolve(sourceRoot, trackedPath), 'utf8')
      if (Buffer.byteLength(source) > maximumMarkdownBytes) {
        throw new Error(`INITIAL_CONTENT_FILE_TOO_LARGE:${trackedPath}`)
      }
      const [, area, ...relativeSegments] = trackedPath.split('/')
      const relativePath = relativeSegments.join('/')
      if (area === 'members') {
        const profile = memberProfileFromMarkdown(source, relativePath, {
          allowLegacyUnknownFields: true
        })
        if (memberKeys.has(profile.memberKey)) {
          throw new Error(`INITIAL_CONTENT_MEMBER_DUPLICATE:${profile.memberKey}`)
        }
        memberKeys.add(profile.memberKey)
        const serialized = serializeMemberProfile(profile)
        await writePrivateFile(temporary, serialized.path, serialized.source)
        members.push({
          memberId: deterministicUuid(input.sourceCommit, 'member', profile.memberKey),
          memberKey: profile.memberKey,
          revisionId: deterministicUuid(input.sourceCommit, 'member-revision', profile.memberKey),
          revisionNumber: 1,
          sourcePath: relativePath,
          path: serialized.path,
          sha256: serialized.sha256,
          bytes: serialized.bytes
        })
        continue
      }
      const collection = area as 'news' | 'wiki'
      const articleId = deterministicUuid(input.sourceCommit, 'article', `${collection}/${relativePath}`)
      const revisionId = deterministicUuid(input.sourceCommit, 'article-revision', `${collection}/${relativePath}`)
      const parsed = parseCmsMarkdown(source)
      const frontmatter = { ...parsed.frontmatter }
      delete frontmatter.vinciId
      const serialized = serializeContentRevision({
        articleId,
        collection,
        relativePath,
        revisionId,
        revisionNumber: 1,
        frontmatter,
        body: parsed.body,
        revisionCreatedAt: generatedAt
      })
      await writePrivateFile(temporary, serialized.path, serialized.source)
      files.push({
        articleId,
        revisionId,
        revisionNumber: 1,
        collection,
        relativePath,
        path: serialized.path,
        sha256: serialized.sha256,
        bytes: serialized.bytes
      })
    }
    const metadata = buildContentRepositoryMetadata(files, [], generatedAt, members)
    await writePrivateFile(temporary, '.vinci/snapshot.json', metadata.snapshotSource)
    await writePrivateFile(temporary, '.vinci/source-commit', `${input.sourceCommit}\n`)
    await writePrivateFile(temporary, 'manifest.json', metadata.manifestSource)
    await rename(temporary, outputRoot)
    return {
      formatVersion: 1,
      sourceCommit: input.sourceCommit,
      sourceRemote: input.expectedRemote,
      sourceBranch: expectedBranch,
      articleCount: files.length,
      memberCount: members.length,
      snapshotSha256: metadata.snapshotSha256,
      manifestSha256: metadata.manifestSha256,
      outputRoot
    }
  } catch (error) {
    await rm(temporary, { recursive: true, force: true })
    throw error
  }
}
