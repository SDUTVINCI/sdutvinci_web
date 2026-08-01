import { execFile } from 'node:child_process'
import { constants, lstatSync } from 'node:fs'
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile
} from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import {
  CONTENT_REPOSITORY_ID,
  getContentExportConfig
} from '../utils/content-export-config'

const runFile = promisify(execFile)
const commitPattern = /^[0-9a-f]{40}$/
const workspaceMarker = 'vinci-content-export-workspace-v1'

export class ContentExportRepositoryError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly stderr = ''
  ) {
    super(message)
  }
}

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`

const assertCredentialFile = (path: string, privateKey: boolean) => {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new ContentExportRepositoryError(
      'CONTENT_EXPORT_CREDENTIAL_FILE_UNSAFE',
      '内容导出凭据必须是普通非符号链接文件'
    )
  }
  if (privateKey && (stat.mode & 0o077) !== 0) {
    throw new ContentExportRepositoryError(
      'CONTENT_EXPORT_PRIVATE_KEY_PERMISSIONS',
      '内容导出 SSH 私钥不得向组或其他用户开放'
    )
  }
}

const gitEnvironment = () => {
  const config = getContentExportConfig()
  const sshKeyFile = config.CONTENT_EXPORT_SSH_KEY_FILE || ''
  const knownHostsFile = config.CONTENT_EXPORT_KNOWN_HOSTS_FILE || ''
  const useSshCredentials = Boolean(
    config.CONTENT_EXPORT_REMOTE_URL.startsWith('git@')
    && sshKeyFile
    && knownHostsFile
  )
  if (useSshCredentials) {
    assertCredentialFile(sshKeyFile, true)
    assertCredentialFile(knownHostsFile, false)
  }
  return {
    ...process.env,
    GIT_AUTHOR_NAME: config.CONTENT_EXPORT_AUTHOR_NAME,
    GIT_AUTHOR_EMAIL: config.CONTENT_EXPORT_AUTHOR_EMAIL,
    GIT_COMMITTER_NAME: config.CONTENT_EXPORT_AUTHOR_NAME,
    GIT_COMMITTER_EMAIL: config.CONTENT_EXPORT_AUTHOR_EMAIL,
    GIT_TERMINAL_PROMPT: '0',
    ...(useSshCredentials
      ? {
          GIT_SSH_COMMAND: [
            'ssh',
            '-o BatchMode=yes',
            '-o IdentitiesOnly=yes',
            '-o StrictHostKeyChecking=yes',
            `-o UserKnownHostsFile=${shellQuote(knownHostsFile)}`,
            `-i ${shellQuote(sshKeyFile)}`
          ].join(' ')
        }
      : {})
  }
}

const runGitRaw = async (args: string[], cwd: string) => {
  try {
    return await runFile('git', args, {
      cwd,
      env: gitEnvironment(),
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024
    })
  } catch (error) {
    if (error instanceof ContentExportRepositoryError) throw error
    const value = error as Error & { stderr?: string }
    throw new ContentExportRepositoryError(
      'CONTENT_EXPORT_GIT_FAILED',
      value.message,
      value.stderr || ''
    )
  }
}

export const runContentExportGit = async (args: string[], cwd?: string) => {
  const config = getContentExportConfig()
  const result = await runGitRaw(args, cwd || config.CONTENT_EXPORT_WORKSPACE)
  return result.stdout.trim()
}

const exists = async (path: string) => {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

const assertDirectoryNotSymlink = async (path: string) => {
  const stat = await lstat(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new ContentExportRepositoryError(
      'CONTENT_EXPORT_WORKSPACE_UNSAFE',
      '内容导出工作区不是普通目录'
    )
  }
}

const markerPath = (workspace: string) =>
  join(workspace, '.git', 'vinci-content-export-owner')

const writeWorkspaceMarker = async (workspace: string) => {
  await writeFile(
    markerPath(workspace),
    `${workspaceMarker}\n${CONTENT_REPOSITORY_ID}\n`,
    { encoding: 'utf8', flag: 'wx', mode: 0o600 }
  )
}

const assertWorkspaceMarker = async (workspace: string) => {
  const path = markerPath(workspace)
  const stat = await lstat(path).catch(() => null)
  if (!stat?.isFile() || stat.isSymbolicLink()) {
    throw new ContentExportRepositoryError(
      'CONTENT_EXPORT_WORKSPACE_UNOWNED',
      '内容导出工作区缺少安全的精确归属标记'
    )
  }
  const marker = await readFile(path, 'utf8').catch(() => '')
  if (marker !== `${workspaceMarker}\n${CONTENT_REPOSITORY_ID}\n`) {
    throw new ContentExportRepositoryError(
      'CONTENT_EXPORT_WORKSPACE_UNOWNED',
      '内容导出工作区缺少精确归属标记'
    )
  }
}

export const ensureContentExportWorkspace = async () => {
  const config = getContentExportConfig()
  const workspace = config.CONTENT_EXPORT_WORKSPACE
  if (!await exists(workspace)) {
    await mkdir(dirname(workspace), { recursive: true })
    await runGitRaw([
      'clone',
      '--origin',
      config.CONTENT_EXPORT_REMOTE,
      '--branch',
      config.CONTENT_EXPORT_BRANCH,
      '--single-branch',
      config.CONTENT_EXPORT_REMOTE_URL,
      workspace
    ], dirname(workspace))
    await writeWorkspaceMarker(workspace)
  }
  await assertDirectoryNotSymlink(workspace)
  const gitDirectory = join(workspace, '.git')
  if (!await exists(gitDirectory)) {
    throw new ContentExportRepositoryError(
      'CONTENT_EXPORT_WORKSPACE_NOT_GIT',
      '内容导出工作区不是独立 Git clone'
    )
  }
  await assertDirectoryNotSymlink(gitDirectory)
  await assertWorkspaceMarker(workspace)
  const [remote, branch] = await Promise.all([
    runContentExportGit(['remote', 'get-url', config.CONTENT_EXPORT_REMOTE]),
    runContentExportGit(['branch', '--show-current'])
  ])
  if (remote !== config.CONTENT_EXPORT_REMOTE_URL || branch !== config.CONTENT_EXPORT_BRANCH) {
    throw new ContentExportRepositoryError(
      'CONTENT_EXPORT_REPOSITORY_MISMATCH',
      '内容导出工作区的远端或分支与配置不一致'
    )
  }
}

export const prepareContentExportWorkspace = async () => {
  const config = getContentExportConfig()
  await ensureContentExportWorkspace()
  const dirty = await runContentExportGit(['status', '--porcelain=v1'])
  if (dirty) {
    throw new ContentExportRepositoryError(
      'CONTENT_EXPORT_WORKSPACE_DIRTY',
      '内容导出工作区存在未提交修改，已停止导出'
    )
  }
  await runContentExportGit(['fetch', '--prune', config.CONTENT_EXPORT_REMOTE])
  const local = await runContentExportGit(['rev-parse', 'HEAD'])
  const remote = await runContentExportGit([
    'rev-parse',
    `${config.CONTENT_EXPORT_REMOTE}/${config.CONTENT_EXPORT_BRANCH}`
  ])
  if (!commitPattern.test(local) || !commitPattern.test(remote)) {
    throw new ContentExportRepositoryError(
      'CONTENT_EXPORT_COMMIT_INVALID',
      '内容仓库提交 ID 格式无效'
    )
  }
  if (local !== remote) {
    const isAncestor = await runContentExportGit([
      'merge-base',
      '--is-ancestor',
      local,
      remote
    ]).then(() => true, () => false)
    if (!isAncestor) {
      throw new ContentExportRepositoryError(
        'CONTENT_EXPORT_NON_FAST_FORWARD',
        '内容仓库 main 不是工作区 HEAD 的快进后继'
      )
    }
    await runContentExportGit([
      'merge',
      '--ff-only',
      `${config.CONTENT_EXPORT_REMOTE}/${config.CONTENT_EXPORT_BRANCH}`
    ])
  }
  return remote
}

const assertManagedGitPath = (gitPath: string) => {
  const normalized = gitPath.replaceAll('\\', '/')
  if (
    normalized.startsWith('/')
    || normalized.includes('\0')
    || normalized.split('/').some(segment => !segment || segment === '.' || segment === '..')
    || !(
      normalized.startsWith('news/')
      || normalized.startsWith('wiki/')
      || normalized.startsWith('members/')
      || normalized.startsWith('content/news/')
      || normalized.startsWith('content/wiki/')
      || normalized.startsWith('content/members/')
      || normalized === '.vinci/snapshot.json'
      || normalized === 'manifest.json'
      || normalized === 'README.md'
    )
  ) {
    throw new ContentExportRepositoryError(
      'CONTENT_EXPORT_PATH_INVALID',
      '导出路径不在受控内容仓库范围内'
    )
  }
  return normalized
}

const assertTargetInsideWorkspace = async (gitPath: string) => {
  const workspace = getContentExportConfig().CONTENT_EXPORT_WORKSPACE
  const normalized = assertManagedGitPath(gitPath)
  const target = resolve(workspace, normalized)
  if (target !== workspace && !target.startsWith(`${workspace}${sep}`)) {
    throw new ContentExportRepositoryError(
      'CONTENT_EXPORT_PATH_OUTSIDE_WORKSPACE',
      '导出路径越过独立内容工作区'
    )
  }
  let current = workspace
  for (const segment of normalized.split('/').slice(0, -1)) {
    current = join(current, segment)
    if (!await exists(current)) {
      await mkdir(current)
    }
    const stat = await lstat(current)
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new ContentExportRepositoryError(
        'CONTENT_EXPORT_PATH_SYMLINK',
        '导出路径包含符号链接或非目录节点'
      )
    }
  }
  const [rootReal, parentReal] = await Promise.all([
    realpath(workspace),
    realpath(dirname(target))
  ])
  if (relative(rootReal, parentReal).startsWith('..')) {
    throw new ContentExportRepositoryError(
      'CONTENT_EXPORT_PATH_OUTSIDE_WORKSPACE',
      '导出目录越过独立内容工作区'
    )
  }
  return { normalized, target }
}

export const writeContentExportFile = async (
  gitPath: string,
  source: string
) => {
  const { normalized, target } = await assertTargetInsideWorkspace(gitPath)
  if (normalized.startsWith('content/')) {
    throw new ContentExportRepositoryError(
      'CONTENT_EXPORT_LEGACY_WRITE_FORBIDDEN',
      '导出器不得向旧 content/ 布局写入内容'
    )
  }
  if (await exists(target)) {
    const stat = await lstat(target)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new ContentExportRepositoryError(
        'CONTENT_EXPORT_TARGET_UNSAFE',
        '导出目标不是普通文件'
      )
    }
    if (await readFile(target, 'utf8') === source) return false
  }
  const temporaryDirectory = await mkdtemp(join(dirname(target), '.vinci-export-'))
  const temporary = join(temporaryDirectory, 'file')
  try {
    await writeFile(temporary, source, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o644
    })
    await rename(temporary, target)
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
  await runContentExportGit(['add', '--', normalized])
  return true
}

export const removeContentExportFile = async (gitPath: string) => {
  const { normalized, target } = await assertTargetInsideWorkspace(gitPath)
  if (!await exists(target)) return false
  const stat = await lstat(target)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new ContentExportRepositoryError(
      'CONTENT_EXPORT_TARGET_UNSAFE',
      '待删除导出目标不是普通文件'
    )
  }
  await rm(target)
  await runContentExportGit(['add', '--', normalized])
  return true
}

export const commitContentExport = async (message: string) => {
  const changed = await runContentExportGit(['diff', '--cached', '--name-only'])
  if (!changed) return null
  await runContentExportGit(['commit', '--message', message])
  const commit = await runContentExportGit(['rev-parse', 'HEAD'])
  if (!commitPattern.test(commit)) {
    throw new ContentExportRepositoryError(
      'CONTENT_EXPORT_COMMIT_INVALID',
      '导出 Commit SHA 格式无效'
    )
  }
  return commit
}

export const pushContentExport = async (expectedBaseCommit: string) => {
  const config = getContentExportConfig()
  const remoteBefore = await runContentExportGit([
    'ls-remote',
    '--heads',
    config.CONTENT_EXPORT_REMOTE,
    `refs/heads/${config.CONTENT_EXPORT_BRANCH}`
  ])
  const remoteCommit = remoteBefore.split(/\s+/)[0]
  if (remoteCommit !== expectedBaseCommit) {
    throw new ContentExportRepositoryError(
      'CONTENT_EXPORT_REMOTE_CHANGED',
      '内容仓库 main 在导出期间发生变化，已拒绝覆盖'
    )
  }
  await runContentExportGit([
    'push',
    '--porcelain',
    config.CONTENT_EXPORT_REMOTE,
    `HEAD:refs/heads/${config.CONTENT_EXPORT_BRANCH}`
  ])
  const local = await runContentExportGit(['rev-parse', 'HEAD'])
  const remoteAfter = await runContentExportGit([
    'ls-remote',
    '--heads',
    config.CONTENT_EXPORT_REMOTE,
    `refs/heads/${config.CONTENT_EXPORT_BRANCH}`
  ])
  if (remoteAfter.split(/\s+/)[0] !== local) {
    throw new ContentExportRepositoryError(
      'CONTENT_EXPORT_PUSH_VERIFY_FAILED',
      'Push 后远端 main 未指向预期导出 Commit'
    )
  }
  return local
}

export const compensateContentExportWorkspace = async () => {
  const config = getContentExportConfig()
  if (!await exists(markerPath(config.CONTENT_EXPORT_WORKSPACE))) return
  await assertWorkspaceMarker(config.CONTENT_EXPORT_WORKSPACE)
  await runContentExportGit(['fetch', '--prune', config.CONTENT_EXPORT_REMOTE])
  await runContentExportGit([
    'reset',
    '--hard',
    `${config.CONTENT_EXPORT_REMOTE}/${config.CONTENT_EXPORT_BRANCH}`
  ])
  await runContentExportGit([
    'clean',
    '-fd',
    '--',
    'news',
    'wiki',
    '.vinci/snapshot.json',
    'manifest.json',
    'README.md'
  ])
}

export const withTemporaryReadOnlyContentClone = async <T>(
  operation: (workspace: string) => Promise<T>
) => {
  const config = getContentExportConfig()
  const root = await mkdtemp(join(tmpdir(), 'vinci-content-dry-run-'))
  const workspace = join(root, 'repository')
  try {
    await runGitRaw([
      'clone',
      '--origin',
      config.CONTENT_EXPORT_REMOTE,
      '--branch',
      config.CONTENT_EXPORT_BRANCH,
      '--single-branch',
      config.CONTENT_EXPORT_REMOTE_URL,
      workspace
    ], root)
    return await operation(workspace)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
