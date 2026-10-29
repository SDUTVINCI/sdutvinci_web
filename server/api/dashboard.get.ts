import { createDashboardService } from '../../utils/dashboard-service.mjs'
import { toWebRequest } from 'h3'

const handleDashboard = createDashboardService()

export default defineEventHandler(event => handleDashboard({
  request: toWebRequest(event),
  env: {
    DASHBOARD_ENABLED: process.env.DASHBOARD_ENABLED,
    DASHBOARD_PUBLIC: process.env.DASHBOARD_PUBLIC,
    DASHBOARD_ACCESS_CODE: process.env.DASHBOARD_ACCESS_CODE,
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
}))
