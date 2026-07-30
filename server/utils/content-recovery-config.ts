import { lstatSync, mkdirSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { z } from 'zod'
import { getContentExportConfig } from './content-export-config'

const schema = z.object({
  CONTENT_RECONCILIATION_ROOT: z.string().min(1),
  CONTENT_RECOVERY_MODE: z.enum(['disabled', 'enabled']).default('disabled'),
  CONTENT_RECOVERY_TEST_MODE: z.enum(['true', 'false']).default('false')
})

const safeRoot = (name: string, value: string) => {
  if (!isAbsolute(value)) throw new Error(`${name} 必须是绝对路径`)
  const resolved = resolve(value)
  if (resolved === '/') throw new Error(`${name} 不得是根目录`)
  mkdirSync(resolved, { recursive: true, mode: 0o700 })
  const stat = lstatSync(resolved)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${name} 必须是普通目录且不得为符号链接`)
  }
  const actual = realpathSync(resolved)
  if (actual !== resolved) throw new Error(`${name} 不得经过符号链接`)
  return actual
}

export interface ContentRecoveryConfig extends z.infer<typeof schema> {
  snapshotsRoot: string
  reportsRoot: string
  temporaryRoot: string
  marker: string
}

let cached: ContentRecoveryConfig | undefined

export const getContentRecoveryConfig = (): ContentRecoveryConfig => {
  if (cached) return cached
  const exportConfig = getContentExportConfig()
  const parsed = schema.parse({
    CONTENT_RECONCILIATION_ROOT:
      process.env.CONTENT_RECONCILIATION_ROOT
      || '/var/lib/vinci-cms/content-reconciliation',
    CONTENT_RECOVERY_MODE: process.env.CONTENT_RECOVERY_MODE,
    CONTENT_RECOVERY_TEST_MODE: process.env.CONTENT_RECOVERY_TEST_MODE
  })
  const root = safeRoot(
    'CONTENT_RECONCILIATION_ROOT',
    parsed.CONTENT_RECONCILIATION_ROOT
  )
  const workspace = resolve(exportConfig.CONTENT_EXPORT_WORKSPACE)
  if (
    root === workspace
    || relative(root, workspace).startsWith('..') === false
    || relative(workspace, root).startsWith('..') === false
  ) {
    throw new Error('对账根目录必须与内容导出工作区隔离')
  }
  if (
    parsed.CONTENT_RECOVERY_MODE === 'enabled'
    && process.env.NODE_ENV !== 'test'
    && parsed.CONTENT_RECOVERY_TEST_MODE === 'true'
  ) {
    throw new Error('测试恢复模式只能在 NODE_ENV=test 使用')
  }
  cached = {
    ...parsed,
    CONTENT_RECONCILIATION_ROOT: root,
    snapshotsRoot: safeRoot('内容快照根目录', resolve(root, 'snapshots')),
    reportsRoot: safeRoot('对账报告根目录', resolve(root, 'reports')),
    temporaryRoot: safeRoot('对账临时根目录', resolve(root, 'tmp')),
    marker: resolve(root, '.vinci-phase7-owner')
  }
  return cached
}

export const resetContentRecoveryConfigForTests = () => {
  cached = undefined
}
