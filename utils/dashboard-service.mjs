import { normalizeDashboardRecords } from './dashboard-data.mjs'
import { createDashboardGithub } from './dashboard-github.mjs'

const FEISHU = 'https://open.feishu.cn/open-apis'
const TASK_TTL = 30_000
const STALE_TTL = 15 * 60_000

function response(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow', ...extra }
  })
}

export function createDashboardService({ fetcher = globalThis.fetch, now = Date.now } = {}) {
  const handlers = new Map()
  return context => {
    const env = context.env || {}
    const keys = ['DASHBOARD_ENABLED', 'FEISHU_APP_ID', 'FEISHU_APP_SECRET',
      'FEISHU_BITABLE_APP_TOKEN', 'FEISHU_BITABLE_TABLE_ID', 'FEISHU_BITABLE_VIEW_ID', 'FEISHU_FIELD_MAP',
      'DASHBOARD_GITHUB_ORG', 'DASHBOARD_GITHUB_REPOS', 'DASHBOARD_GITHUB_EXCLUDE_REPOS', 'DASHBOARD_GITHUB_TOKEN', 'DASHBOARD_GITHUB_PEOPLE']
    const scope = JSON.stringify(keys.map(key => env[key] || ''))
    if (!handlers.has(scope)) {
      if (handlers.size >= 4) handlers.delete(handlers.keys().next().value)
      handlers.set(scope, createScopedService({ fetcher, now }))
    }
    return handlers.get(scope)(context)
  }
}

function createScopedService({ fetcher, now }) {
  // 仅为当前运行实例中的临时缓存；业务记录始终由飞书保存。
  let token, tokenPending, taskCache, taskPending

  async function json(url, options = {}) {
    // GitHub 的父信号已有更短的整轮预算，直接传递，避免套叠信号监听。
    const controller = options.signal ? null : new AbortController()
    const signal = options.signal || controller.signal
    const timer = controller ? setTimeout(() => controller.abort(), 10_000) : undefined
    try {
      let result
      try { result = await fetcher(url, { ...options, signal, redirect: options.redirect || 'error' }) }
      catch (error) {
        // 仅分类，不把任意异常、请求头或凭证内容送往客户端。
        const message = String(error?.message || '')
        throw new Error(/redirect/i.test(message) ? 'UPSTREAM_REDIRECT'
          : /header|ByteString|ISO-8859-1|Latin.?1/i.test(message) ? 'INVALID_REQUEST_HEADERS' : 'UPSTREAM_FETCH_FAILED')
      }
      const status = Number(result.status)
      if (status === 0) throw new Error(result.type === 'opaqueredirect' ? 'OPAQUE_REDIRECT' : 'OPAQUE_RESPONSE')
      if (!Number.isInteger(status) || status < 100 || status > 599) throw new Error('INVALID_HTTP_RESPONSE')
      if (status < 200 || status >= 300) throw new Error(status === 401 ? 'UPSTREAM_UNAUTHORIZED' : `UPSTREAM_HTTP_${status}`)
      if (status === 204) return []
      try { return await result.json() }
      catch (error) {
        if (error?.name === 'SyntaxError') throw error
        throw new Error('UPSTREAM_BODY_FAILED')
      }
    } finally { if (timer !== undefined) clearTimeout(timer) }
  }

  async function tenantToken(env) {
    if (token && token.until > now()) return token.value
    if (!tokenPending) tokenPending = (async () => {
      const result = await json(`${FEISHU}/auth/v3/tenant_access_token/internal`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET })
      })
      if (result.code !== 0 || !result.tenant_access_token) throw new Error('FEISHU_AUTH_FAILED')
      token = { value: result.tenant_access_token, until: now() + Math.max(0, (Number(result.expire) || 7200) - 60) * 1000 }
      return token.value
    })().finally(() => { tokenPending = undefined })
    return tokenPending
  }

  async function readTasks(env) {
    const records = [], seenPages = new Set()
    let pageToken = ''
    for (let page = 0; page < 4; page++) {
      const url = new URL(`${FEISHU}/bitable/v1/apps/${encodeURIComponent(env.FEISHU_BITABLE_APP_TOKEN)}/tables/${encodeURIComponent(env.FEISHU_BITABLE_TABLE_ID)}/records`)
      url.searchParams.set('page_size', '500')
      if (pageToken) url.searchParams.set('page_token', pageToken)
      if (env.FEISHU_BITABLE_VIEW_ID) url.searchParams.set('view_id', env.FEISHU_BITABLE_VIEW_ID)
      let result
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          result = await json(url.href, { headers: { Authorization: `Bearer ${await tenantToken(env)}` } })
          if ([99991661, 99991663, 99991668].includes(result.code)) throw new Error('UPSTREAM_UNAUTHORIZED')
          break
        } catch (error) {
          if (attempt || error.message !== 'UPSTREAM_UNAUTHORIZED') throw error
          token = undefined
        }
      }
      if (result.code !== 0 || !Array.isArray(result.data?.items)) throw new Error('FEISHU_READ_FAILED')
      records.push(...result.data.items)
      if (!result.data.has_more) {
        const statusIssues = []
        const tasks = normalizeDashboardRecords(records, JSON.parse(env.FEISHU_FIELD_MAP || '{}'), { statusIssues })
        if (statusIssues.length && !tasks.length) throw Object.assign(new Error('INVALID_TASK_STATUS'), { statusIssues })
        if (records.some(record => Object.keys(record.fields || {}).length) && !tasks.length) throw new Error('INVALID_FIELD_MAP')
        return { tasks, statusIssues }
      }
      pageToken = result.data.page_token
      if (!pageToken || seenPages.has(pageToken)) throw new Error('INVALID_PAGINATION')
      seenPages.add(pageToken)
    }
    throw new Error('TASK_LIMIT_EXCEEDED')
  }

  async function tasks(env) {
    if (taskCache && now() - taskCache.at < TASK_TTL) return { ...taskCache, stale: false }
    if (!taskPending) taskPending = readTasks(env).then(value => {
      taskCache = { value: value.tasks, statusIssues: value.statusIssues, at: now() }
      return { ...taskCache, stale: false }
    }).catch(error => {
      if (taskCache && now() - taskCache.at <= STALE_TTL) return { ...taskCache, stale: true }
      throw error
    }).finally(() => { taskPending = undefined })
    return taskPending
  }


  const development = createDashboardGithub({ json, now })

  return async function handle({ request, env = {}, authenticated = false }) {
    if (request.method !== 'GET') return response({ code: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET' })
    // 只能由服务端校验网站会话后设置；不接受请求头、查询参数或旧共享口令替代登录。
    if (authenticated !== true) return response({ code: 'LOGIN_REQUIRED', message: '请先登录。' }, 401)
    const required = ['FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'FEISHU_BITABLE_APP_TOKEN', 'FEISHU_BITABLE_TABLE_ID']
    if (env.DASHBOARD_ENABLED !== 'true' || required.some(key => !env[key])) {
      return response({ code: 'NOT_CONFIGURED', message: '看板尚未开放，请联系团队负责人。' }, 503)
    }
    try {
      const [data, activity] = await Promise.all([tasks(env), development(env)])
      return response({ tasks: data.value, statusIssues: data.statusIssues, updatedAt: data.at, stale: data.stale, refreshSeconds: 30, development: activity })
    } catch (error) {
      const reasons = ['INVALID_FIELD_MAP', 'INVALID_TASK_STATUS', 'INVALID_TASK_DATE', 'INVALID_TASK_ID', 'TASK_LIMIT_EXCEEDED', 'INVALID_PAGINATION', 'FEISHU_AUTH_FAILED', 'FEISHU_READ_FAILED']
      const reason = reasons.includes(error.message) ? error.message : 'UPSTREAM_UNAVAILABLE'
      return response({ code: 'DATA_UNAVAILABLE', reason, message: '暂时无法更新任务，请稍后重试。',
        ...(reason === 'INVALID_TASK_STATUS' && Array.isArray(error.statusIssues) ? { statusIssues: error.statusIssues } : {}) }, 502)
    }
  }
}
