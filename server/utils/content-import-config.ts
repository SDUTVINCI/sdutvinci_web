import { z } from 'zod'
import { CONTENT_REPOSITORY_ID } from './content-export-config'

const schema = z.object({
  CONTENT_PR_IMPORT_MODE: z.enum(['disabled', 'enabled']).default('disabled'),
  CONTENT_PR_IMPORT_REPOSITORY_ID: z.literal(CONTENT_REPOSITORY_ID)
    .default(CONTENT_REPOSITORY_ID),
  CONTENT_PR_IMPORT_API_URL: z.string().url().default('https://api.github.com'),
  CONTENT_PR_IMPORT_GITHUB_TOKEN: z.string().min(1).optional(),
  CONTENT_PR_IMPORT_MAX_FILE_BYTES: z.coerce.number().int().min(1024).max(5_000_000)
    .default(1_048_576),
  CONTENT_PR_IMPORT_MAX_FILES: z.coerce.number().int().min(1).max(500).default(200),
  CONTENT_PR_IMPORT_RETRY_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(3),
  CONTENT_PR_IMPORT_TEST_MODE: z.enum(['false', 'true']).default('false')
})

export type ContentImportConfig = z.infer<typeof schema> & { testMode: boolean }

let cached: ContentImportConfig | undefined

export const getContentImportConfig = (): ContentImportConfig => {
  if (cached) return cached
  const parsed = schema.parse(process.env)
  const testMode = parsed.CONTENT_PR_IMPORT_TEST_MODE === 'true'
  // Reflect.get keeps this a runtime guard in Nitro's production bundle instead
  // of letting the bundler replace process.env.NODE_ENV with a build-time literal.
  if (testMode && Reflect.get(process.env, 'NODE_ENV') !== 'test') {
    throw new Error('CONTENT_PR_IMPORT_TEST_MODE 只允许 NODE_ENV=test')
  }
  const url = new URL(parsed.CONTENT_PR_IMPORT_API_URL)
  if (!testMode && (url.protocol !== 'https:' || url.hostname !== 'api.github.com')) {
    throw new Error('正式 PR 导入只允许 GitHub 官方 HTTPS API')
  }
  if (url.username || url.password) {
    throw new Error('PR 导入 API URL 不得包含凭据')
  }
  cached = { ...parsed, testMode }
  return cached
}

export const resetContentImportConfigForTests = () => {
  cached = undefined
}
