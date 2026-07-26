import { z } from 'zod'

const booleanString = z
  .enum(['true', 'false'])
  .transform(value => value === 'true')

const serverConfigSchema = z.object({
  CMS_AUTH_SECRET: z.string().min(32, 'CMS_AUTH_SECRET 至少需要 32 个字符'),
  CMS_SESSION_COOKIE: z.string().min(1).default('vinci_cms_session'),
  CMS_SESSION_TTL_HOURS: z.coerce.number().int().positive().max(24 * 90).default(168),
  CMS_SECURE_COOKIES: booleanString.default(false),
  CMS_LOGIN_FAILURE_LIMIT: z.coerce.number().int().min(2).max(20).default(5),
  CMS_LOGIN_FAILURE_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  CMS_LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  CMS_LOGIN_IP_ATTEMPT_LIMIT: z.coerce.number().int().min(5).max(1000).default(30),
  CMS_LOGIN_IP_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(5),
  CMS_MEDIA_UPLOAD_LIMIT: z.coerce.number().int().min(1).max(1000).default(20),
  CMS_MEDIA_UPLOAD_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(1),
  NUXT_PUBLIC_SITE_URL: z.string().url().optional()
})

export type CmsServerConfig = z.infer<typeof serverConfigSchema>

let cachedConfig: CmsServerConfig | undefined

export const getCmsServerConfig = (): CmsServerConfig => {
  if (!cachedConfig) {
    cachedConfig = serverConfigSchema.parse(process.env)
  }

  return cachedConfig
}

export const resetCmsServerConfigForTests = () => {
  cachedConfig = undefined
}
