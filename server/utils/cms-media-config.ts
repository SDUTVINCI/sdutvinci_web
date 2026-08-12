import { z } from 'zod'

const booleanString = z
  .enum(['true', 'false'])
  .transform(value => value === 'true')

const mediaConfigSchema = z.object({
  S3_ENDPOINT: z.string().url('S3_ENDPOINT 必须是有效 URL'),
  S3_REGION: z.string().trim().min(1, 'S3_REGION 不能为空'),
  S3_BUCKET: z.string().trim().min(1, 'S3_BUCKET 不能为空'),
  S3_ACCESS_KEY_ID: z.string().min(1, 'S3_ACCESS_KEY_ID 不能为空'),
  S3_SECRET_ACCESS_KEY: z.string().min(1, 'S3_SECRET_ACCESS_KEY 不能为空'),
  S3_PUBLIC_BASE_URL: z.string().url('S3_PUBLIC_BASE_URL 必须是有效 URL'),
  S3_FORCE_PATH_STYLE: booleanString.default(false),
  S3_KEY_PREFIX: z.string().trim().default('site-assets/images'),
  CMS_IMAGE_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(50 * 1024 * 1024)
    .default(10 * 1024 * 1024),
  CMS_IMAGE_MAX_WIDTH: z.coerce.number().int().min(320).max(8192).default(2560),
  CMS_IMAGE_MAX_HEIGHT: z.coerce.number().int().min(320).max(8192).default(2560),
  CMS_IMAGE_WEBP_QUALITY: z.coerce.number().int().min(1).max(100).default(82)
}).superRefine((config, context) => {
  if (
    config.S3_KEY_PREFIX.startsWith('/')
    || config.S3_KEY_PREFIX.endsWith('/')
    || config.S3_KEY_PREFIX.split('/').some(segment =>
      !segment || segment === '.' || segment === '..' || !/^[a-zA-Z0-9_-]+$/.test(segment)
    )
  ) {
    context.addIssue({
      code: 'custom',
      path: ['S3_KEY_PREFIX'],
      message: 'S3_KEY_PREFIX 只能包含字母、数字、下划线、短横线和安全的路径分段'
    })
  }
})

export type CmsMediaConfig = z.infer<typeof mediaConfigSchema>

let cachedConfig: CmsMediaConfig | undefined

export const getCmsMediaConfig = (): CmsMediaConfig => {
  cachedConfig ||= mediaConfigSchema.parse(process.env)
  return cachedConfig
}

export const resetCmsMediaConfigForTests = () => {
  cachedConfig = undefined
}
