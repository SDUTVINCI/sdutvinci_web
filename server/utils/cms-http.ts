import type { H3Event } from 'h3'
import {
  createError,
  deleteCookie,
  getCookie,
  getHeader,
  getRequestIP,
  getRequestURL,
  setCookie,
  setResponseHeader
} from 'h3'
import type { CmsRoleCode, CmsUser } from '../../shared/types/cms-auth'
import { getCmsSessionUser } from '../services/cms-auth'
import { CmsRateLimitError } from '../services/cms-rate-limits'
import { getCmsServerConfig } from './cms-config'
import { createCsrfToken, verifyCsrfToken } from './cms-security'

export interface CmsRequestAuth {
  token: string
  user: CmsUser
}

export const setCmsSessionCookie = (
  event: H3Event,
  token: string,
  expiresAt: Date
) => {
  const config = getCmsServerConfig()
  setCookie(event, config.CMS_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.CMS_SECURE_COOKIES,
    path: '/',
    expires: expiresAt
  })
}

export const clearCmsSessionCookie = (event: H3Event) => {
  const config = getCmsServerConfig()
  deleteCookie(event, config.CMS_SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.CMS_SECURE_COOKIES,
    path: '/'
  })
}

export const getCmsRequestAuth = async (event: H3Event): Promise<CmsRequestAuth | null> => {
  const token = getCookie(event, getCmsServerConfig().CMS_SESSION_COOKIE)

  if (!token) {
    return null
  }

  const user = await getCmsSessionUser(token)
  if (!user) {
    clearCmsSessionCookie(event)
  }
  return user ? { token, user } : null
}

export const requireCmsRequestAuth = async (
  event: H3Event,
  role?: CmsRoleCode
): Promise<CmsRequestAuth> => {
  const auth = await getCmsRequestAuth(event)

  if (!auth) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  if (role && !auth.user.roles.includes(role)) {
    throw createError({ statusCode: 403, message: '权限不足' })
  }

  return auth
}

export const getCmsCsrfToken = (auth: CmsRequestAuth) =>
  createCsrfToken(auth.token)

export const requireSameOrigin = (event: H3Event) => {
  const origin = getHeader(event, 'origin')

  if (!origin) {
    throw createError({ statusCode: 403, message: '缺少 Origin 请求头' })
  }

  let requestOrigin: string
  try {
    requestOrigin = getRequestURL(event, {
      xForwardedHost: true,
      xForwardedProto: true
    }).origin
  } catch {
    throw createError({ statusCode: 403, message: '无法确认请求来源' })
  }

  const configuredOrigin = getCmsServerConfig().NUXT_PUBLIC_SITE_URL
    ? new URL(getCmsServerConfig().NUXT_PUBLIC_SITE_URL!).origin
    : requestOrigin

  if (!isCmsOriginTrusted(origin, requestOrigin, configuredOrigin)) {
    throw createError({ statusCode: 403, message: '请求来源不受信任' })
  }
}

export const isCmsOriginTrusted = (
  origin: string,
  requestOrigin: string,
  configuredOrigin?: string
) => origin === requestOrigin || (
  Boolean(configuredOrigin) && origin === configuredOrigin
)

export const requireCmsCsrf = (event: H3Event, auth: CmsRequestAuth) => {
  requireSameOrigin(event)

  if (!verifyCsrfToken(auth.token, getHeader(event, 'x-csrf-token'))) {
    throw createError({ statusCode: 403, message: 'CSRF 校验失败' })
  }
}

export const getCmsRequestIp = (event: H3Event) =>
  getRequestIP(event, { xForwardedFor: true })

export const throwCmsRateLimitError = (
  event: H3Event,
  error: CmsRateLimitError,
  message = '请求过于频繁，请稍后重试'
): never => {
  setResponseHeader(event, 'retry-after', error.retryAfterSeconds)
  throw createError({
    statusCode: 429,
    message,
    data: {
      code: 'RATE_LIMITED',
      retryAfterSeconds: error.retryAfterSeconds
    }
  })
}
