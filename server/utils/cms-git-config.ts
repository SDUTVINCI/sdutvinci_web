import { resolve } from 'node:path'
import { z } from 'zod'

const gitConfigSchema = z.object({
  CMS_GIT_WORKTREE: z.string().min(1),
  CMS_GIT_REMOTE_URL: z.string().min(1),
  CMS_GIT_REMOTE: z.string().regex(/^[A-Za-z0-9._-]+$/).default('origin'),
  CMS_GIT_BRANCH: z.string().regex(/^[A-Za-z0-9._/-]+$/).default('main'),
  CMS_GIT_AUTHOR_NAME: z.string().min(1).default('Vinci CMS'),
  CMS_GIT_AUTHOR_EMAIL: z.string().email().default('cms@localhost'),
  CMS_GIT_SSH_KEY_PATH: z.string().min(1).optional(),
  CMS_CONTENT_ROOT: z.string().min(1).default('content')
})

export type CmsGitConfig = z.infer<typeof gitConfigSchema>

let cachedConfig: CmsGitConfig | undefined

export const getCmsGitConfig = (): CmsGitConfig => {
  if (!cachedConfig) {
    cachedConfig = gitConfigSchema.parse(process.env)
    const worktree = resolve(cachedConfig.CMS_GIT_WORKTREE)
    const contentRoot = resolve(cachedConfig.CMS_CONTENT_ROOT)
    if (
      worktree === contentRoot
      || worktree.startsWith(`${contentRoot}/`)
      || contentRoot.startsWith(`${worktree}/`)
    ) {
      throw new Error('CMS_GIT_WORKTREE 必须与正式站点 CMS_CONTENT_ROOT 隔离')
    }
    cachedConfig.CMS_GIT_WORKTREE = worktree
  }
  return cachedConfig
}

export const resetCmsGitConfigForTests = () => {
  cachedConfig = undefined
}
