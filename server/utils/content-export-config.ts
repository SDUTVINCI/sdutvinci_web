import { isAbsolute, relative, resolve } from 'node:path'
import { z } from 'zod'

export const CONTENT_REPOSITORY_ID = 'SDUTVINCI/sdutvinci_content'
export const CONTENT_REPOSITORY_HTTPS_URL =
  'https://github.com/SDUTVINCI/sdutvinci_content.git'

const positiveInteger = (fallback: number, minimum = 1, maximum = 86_400) =>
  z.coerce.number().int().min(minimum).max(maximum).default(fallback)

const schema = z.object({
  CONTENT_REPOSITORY_ID: z.literal(CONTENT_REPOSITORY_ID)
    .default(CONTENT_REPOSITORY_ID),
  CONTENT_EXPORT_MODE: z.enum(['disabled', 'dry_run', 'enabled'])
    .default('disabled'),
  CONTENT_EXPORT_REMOTE_URL: z.string().min(1)
    .default(CONTENT_REPOSITORY_HTTPS_URL),
  CONTENT_EXPORT_REMOTE: z.string().regex(/^[A-Za-z0-9._-]+$/).default('origin'),
  CONTENT_EXPORT_BRANCH: z.literal('main').default('main'),
  CONTENT_EXPORT_WORKSPACE: z.string().min(1)
    .default('/var/lib/vinci-cms/content-export'),
  CONTENT_EXPORT_AUTHOR_NAME: z.string().min(1).default('Vinci Content Exporter'),
  CONTENT_EXPORT_AUTHOR_EMAIL: z.string().email().default('content-export@localhost'),
  CONTENT_EXPORT_SSH_KEY_FILE: z.string().min(1).optional(),
  CONTENT_EXPORT_KNOWN_HOSTS_FILE: z.string().min(1).optional(),
  CONTENT_EXPORT_BATCH_SIZE: positiveInteger(50, 1, 200),
  CONTENT_EXPORT_POLL_SECONDS: positiveInteger(60, 1, 3600),
  CONTENT_EXPORT_LEASE_SECONDS: positiveInteger(300, 30, 3600),
  CONTENT_EXPORT_MAX_ATTEMPTS: positiveInteger(5, 1, 20),
  CONTENT_EXPORT_RETRY_BASE_SECONDS: positiveInteger(60, 1, 3600),
  CONTENT_EXPORT_RETRY_MAX_SECONDS: positiveInteger(3600, 1, 86_400),
  CONTENT_EXPORT_TEST_MODE: z.enum(['false', 'true']).default('false'),
  CMS_CONTENT_ROOT: z.string().min(1).default('content'),
  CMS_GIT_WORKTREE: z.string().min(1).default('/var/lib/vinci-cms/worktree')
})

export type ContentExportConfig = z.infer<typeof schema> & {
  testMode: boolean
}

const overlaps = (left: string, right: string) => {
  const fromLeft = relative(left, right)
  const fromRight = relative(right, left)
  return (
    fromLeft === ''
    || (!fromLeft.startsWith('..') && !isAbsolute(fromLeft))
    || (!fromRight.startsWith('..') && !isAbsolute(fromRight))
  )
}

const isOfficialRemote = (value: string) => {
  const normalized = value.replace(/\/+$/, '')
  return [
    'https://github.com/SDUTVINCI/sdutvinci_content.git',
    'git@github.com:SDUTVINCI/sdutvinci_content.git',
    'ssh://git@github.com/SDUTVINCI/sdutvinci_content.git'
  ].includes(normalized)
}

let cached: ContentExportConfig | undefined

export const getContentExportConfig = (): ContentExportConfig => {
  if (cached) return cached
  const parsed = schema.parse(process.env)
  const testMode = parsed.CONTENT_EXPORT_TEST_MODE === 'true'
  if (testMode && process.env.NODE_ENV !== 'test') {
    throw new Error('CONTENT_EXPORT_TEST_MODE 只允许 NODE_ENV=test')
  }
  if (!isOfficialRemote(parsed.CONTENT_EXPORT_REMOTE_URL) && !testMode) {
    throw new Error(
      `内容导出远端必须是唯一正式仓库 ${CONTENT_REPOSITORY_ID}`
    )
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(parsed.CONTENT_EXPORT_REMOTE_URL)) {
    const url = new URL(parsed.CONTENT_EXPORT_REMOTE_URL)
    if ((url.username && url.username !== 'git') || url.password) {
      throw new Error('CONTENT_EXPORT_REMOTE_URL 不得包含内嵌凭据')
    }
  }
  if (
    parsed.CONTENT_EXPORT_MODE === 'enabled'
    && !testMode
    && (
      !parsed.CONTENT_EXPORT_SSH_KEY_FILE
      || !parsed.CONTENT_EXPORT_KNOWN_HOSTS_FILE
      || !parsed.CONTENT_EXPORT_REMOTE_URL.startsWith('git@')
      || !isAbsolute(parsed.CONTENT_EXPORT_SSH_KEY_FILE)
      || !isAbsolute(parsed.CONTENT_EXPORT_KNOWN_HOSTS_FILE)
    )
  ) {
    throw new Error('正式导出必须使用独立 SSH key、known_hosts 和仓库级 SSH 远端')
  }
  if (parsed.CONTENT_EXPORT_RETRY_BASE_SECONDS > parsed.CONTENT_EXPORT_RETRY_MAX_SECONDS) {
    throw new Error('CONTENT_EXPORT_RETRY_BASE_SECONDS 不得大于最大退避时间')
  }

  const workspace = resolve(parsed.CONTENT_EXPORT_WORKSPACE)
  const applicationRoot = resolve(process.cwd())
  const contentRoot = resolve(parsed.CMS_CONTENT_ROOT)
  const legacyWorktree = resolve(parsed.CMS_GIT_WORKTREE)
  if (
    overlaps(workspace, applicationRoot)
    || overlaps(workspace, contentRoot)
    || overlaps(workspace, legacyWorktree)
  ) {
    throw new Error('内容导出工作区必须与代码、正式 Markdown 和旧 CMS Git 工作区隔离')
  }

  cached = {
    ...parsed,
    CONTENT_EXPORT_WORKSPACE: workspace,
    testMode
  }
  return cached
}

export const resetContentExportConfigForTests = () => {
  cached = undefined
}
