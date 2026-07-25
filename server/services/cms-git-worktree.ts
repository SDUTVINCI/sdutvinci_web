import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
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
import { promisify } from 'node:util'
import type { CmsArticleCollection } from '../../shared/types/cms-articles'
import { getDatabasePool } from '../db/client'
import { getCmsGitConfig } from '../utils/cms-git-config'

const runFile = promisify(execFile)
const gitCommitPattern = /^[0-9a-f]{7,64}$/
const publishLockKey = 0x56494e4349434d53n

const gitEnvironment = () => {
  const config = getCmsGitConfig()
  return {
    ...process.env,
    GIT_AUTHOR_NAME: config.CMS_GIT_AUTHOR_NAME,
    GIT_AUTHOR_EMAIL: config.CMS_GIT_AUTHOR_EMAIL,
    GIT_COMMITTER_NAME: config.CMS_GIT_AUTHOR_NAME,
    GIT_COMMITTER_EMAIL: config.CMS_GIT_AUTHOR_EMAIL,
    ...(config.CMS_GIT_SSH_KEY_PATH
      ? {
          GIT_SSH_COMMAND: `ssh -i ${config.CMS_GIT_SSH_KEY_PATH} -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes`
        }
      : {})
  }
}

export const runCmsGitRaw = async (args: string[], cwd?: string) => {
  const config = getCmsGitConfig()
  const result = await runFile('git', args, {
    cwd: cwd || config.CMS_GIT_WORKTREE,
    env: gitEnvironment(),
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024
  })
  return result.stdout
}

export const runCmsGit = async (args: string[], cwd?: string) =>
  (await runCmsGitRaw(args, cwd)).trim()

const pathExists = async (path: string) => {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

export const ensureCmsGitWorktree = async () => {
  const config = getCmsGitConfig()
  if (!await pathExists(config.CMS_GIT_WORKTREE)) {
    await mkdir(dirname(config.CMS_GIT_WORKTREE), { recursive: true })
    await runCmsGit([
      'clone',
      '--origin',
      config.CMS_GIT_REMOTE,
      '--branch',
      config.CMS_GIT_BRANCH,
      '--single-branch',
      config.CMS_GIT_REMOTE_URL,
      config.CMS_GIT_WORKTREE
    ], dirname(config.CMS_GIT_WORKTREE))
  }
  if (!await pathExists(join(config.CMS_GIT_WORKTREE, '.git'))) {
    throw new Error('CMS_GIT_WORKTREE 不是独立 Git 工作区')
  }
  const configuredRemote = await runCmsGit(['remote', 'get-url', config.CMS_GIT_REMOTE])
  if (configuredRemote !== config.CMS_GIT_REMOTE_URL) {
    throw new Error('CMS Git 工作区远端与 CMS_GIT_REMOTE_URL 不一致')
  }
}

export const prepareCmsGitWorktree = async () => {
  const config = getCmsGitConfig()
  await ensureCmsGitWorktree()
  const dirty = await runCmsGit(['status', '--porcelain'])
  if (dirty) throw new Error('CMS Git 工作区存在未提交修改，已停止发布')
  await runCmsGit(['fetch', '--prune', config.CMS_GIT_REMOTE])
  await runCmsGit(['checkout', config.CMS_GIT_BRANCH])
  await runCmsGit([
    'reset',
    '--hard',
    `${config.CMS_GIT_REMOTE}/${config.CMS_GIT_BRANCH}`
  ])
}

export const resetCmsGitWorktree = async () => {
  const config = getCmsGitConfig()
  await runCmsGit([
    'reset',
    '--hard',
    `${config.CMS_GIT_REMOTE}/${config.CMS_GIT_BRANCH}`
  ])
}

const assertRelativeMarkdownPath = (relativePath: string) => {
  const normalized = relativePath.replaceAll('\\', '/')
  if (
    !normalized
    || normalized.startsWith('/')
    || normalized.split('/').includes('..')
    || !normalized.endsWith('.md')
  ) {
    throw new Error('文章路径必须是安全的相对 Markdown 路径')
  }
  return normalized
}

export const cmsGitArticlePath = (
  collection: CmsArticleCollection,
  relativePath: string
) => {
  const config = getCmsGitConfig()
  const safePath = assertRelativeMarkdownPath(relativePath)
  const collectionRoot = resolve(config.CMS_GIT_WORKTREE, 'content', collection)
  const target = resolve(collectionRoot, safePath)
  if (target !== collectionRoot && !target.startsWith(`${collectionRoot}${sep}`)) {
    throw new Error('文章路径越过了集合目录')
  }
  return { target, safePath, gitPath: `content/${collection}/${safePath}` }
}

export const atomicWriteCmsGitArticle = async (
  collection: CmsArticleCollection,
  relativePath: string,
  source: string
) => {
  const { target, safePath, gitPath } = cmsGitArticlePath(collection, relativePath)
  const config = getCmsGitConfig()
  await mkdir(dirname(target), { recursive: true })
  const rootReal = await realpath(config.CMS_GIT_WORKTREE)
  const parentReal = await realpath(dirname(target))
  if (relative(rootReal, parentReal).startsWith('..')) {
    throw new Error('文章目录越过了 CMS Git 工作区')
  }
  if (await pathExists(target)) {
    const stat = await lstat(target)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error('文章目标不是普通文件')
    }
  }
  const tempDirectory = await mkdtemp(join(dirname(target), '.cms-publish-'))
  const temporary = join(tempDirectory, 'article.md')
  try {
    await writeFile(temporary, source, { encoding: 'utf8', flag: 'wx', mode: 0o644 })
    await rename(temporary, target)
  } finally {
    await rm(tempDirectory, { recursive: true, force: true })
  }
  return { target, safePath, gitPath }
}

export const readCmsGitArticle = async (
  collection: CmsArticleCollection,
  relativePath: string
) => readFile(cmsGitArticlePath(collection, relativePath).target, 'utf8')

export const removeCmsGitArticle = async (
  collection: CmsArticleCollection,
  relativePath: string
) => {
  const resolved = cmsGitArticlePath(collection, relativePath)
  const stat = await lstat(resolved.target)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('文章目标不是普通文件')
  }
  await rm(resolved.target)
  return resolved
}

export const assertCmsGitCommit = (commit: string) => {
  if (!gitCommitPattern.test(commit)) throw new Error('无效的 Git 提交 ID')
  return commit
}

export const withCmsPublishLock = async <T>(operation: () => Promise<T>) => {
  const client = await getDatabasePool().connect()
  try {
    await client.query('select pg_advisory_lock($1)', [publishLockKey.toString()])
    return await operation()
  } finally {
    await client.query('select pg_advisory_unlock($1)', [publishLockKey.toString()])
    client.release()
  }
}
