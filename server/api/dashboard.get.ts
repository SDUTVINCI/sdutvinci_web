import { createDashboardService } from '../../utils/dashboard-service.mjs'
import { defineEventHandler, setResponseHeader, toWebRequest } from 'h3'
import { requireSiteRequestAuth } from '../utils/cms-http'

const handleDashboard = createDashboardService()

export default defineEventHandler(async event => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  setResponseHeader(event, 'Vary', 'Cookie')
  setResponseHeader(event, 'X-Robots-Tag', 'noindex, nofollow')
  // 每次请求（包括缓存命中）均检查有效会话，允许所有已登录的网站账号。
  await requireSiteRequestAuth(event)
  return handleDashboard({
    request: toWebRequest(event),
    authenticated: true,
    env: {
      DASHBOARD_ENABLED: process.env.DASHBOARD_ENABLED,
      FEISHU_APP_ID: process.env.FEISHU_APP_ID,
      FEISHU_APP_SECRET: process.env.FEISHU_APP_SECRET,
      FEISHU_BITABLE_APP_TOKEN: process.env.FEISHU_BITABLE_APP_TOKEN,
      FEISHU_BITABLE_TABLE_ID: process.env.FEISHU_BITABLE_TABLE_ID,
      FEISHU_BITABLE_VIEW_ID: process.env.FEISHU_BITABLE_VIEW_ID,
      FEISHU_FIELD_MAP: process.env.FEISHU_FIELD_MAP,
      DASHBOARD_GITHUB_ORG: process.env.DASHBOARD_GITHUB_ORG ?? 'SDUTVINCI',
      DASHBOARD_GITHUB_REPOS: process.env.DASHBOARD_GITHUB_REPOS,
      DASHBOARD_GITHUB_EXCLUDE_REPOS: process.env.DASHBOARD_GITHUB_EXCLUDE_REPOS,
      DASHBOARD_GITHUB_TOKEN: process.env.DASHBOARD_GITHUB_TOKEN,
      DASHBOARD_GITHUB_PEOPLE: process.env.DASHBOARD_GITHUB_PEOPLE
    }
  })
})
