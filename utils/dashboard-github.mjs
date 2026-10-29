import { safeDashboardUrl } from './dashboard-data.mjs'

const API = 'https://api.github.com'
const MAX_AGE = 24 * 60 * 60_000
const cleanName = (value, fallback) => typeof value === 'string' && value.trim() && !value.includes('@') ? value.trim().slice(0, 100) : fallback
const empty = () => ({ enabled: false, unavailable: false, contributors: [], events: [], sources: [] })
const diagnosticCodes = new Set(['SYNC_BUDGET_EXCEEDED', 'INVALID_ORGANIZATION_REPOS', 'INVALID_ORGANIZATION_REPO',
  'INVALID_ORGANIZATION_NAMESPACE', 'INVALID_ORGANIZATION_PAGINATION', 'ORGANIZATION_REPO_LIMIT',
  'INVALID_CONTRIBUTORS', 'INVALID_CONTRIBUTOR_PAGINATION', 'CONTRIBUTOR_LIMIT_EXCEEDED', 'PUBLIC_REPOSITORY_REQUIRED', 'INVALID_CODE_EVENTS', 'INVALID_CODE_PERSON', 'CONFLICTING_CODE_PERSON',
  'ABORT_LISTENERS_UNSUPPORTED', 'ABORT_SIGNAL_UNSUPPORTED', 'INVALID_TOKEN_FORMAT', 'UPSTREAM_FETCH_FAILED',
  'UPSTREAM_BODY_FAILED', 'INVALID_REQUEST_HEADERS', 'UPSTREAM_REDIRECT', 'INVALID_GITHUB_REPOS',
  'OPAQUE_REDIRECT', 'OPAQUE_RESPONSE', 'INVALID_HTTP_RESPONSE'])
function diagnostic(error) {
  if (error?.message === 'UPSTREAM_UNAUTHORIZED') return 'HTTP_401'
  if (/^UPSTREAM_HTTP_[1-5]\d\d$/.test(error?.message || '')) return error.message.replace('UPSTREAM_', '')
  if (Number.isInteger(error?.status) && error.status >= 300 && error.status <= 599) return `HTTP_${error.status}`
  if (error?.name === 'SyntaxError') return 'INVALID_JSON_RESPONSE'
  if (error?.name === 'TypeError') return 'TYPE_ERROR'
  return diagnosticCodes.has(error?.message) ? error.message : 'READ_FAILED'
}

function repositoryPath(repo) {
  if (typeof repo !== 'string' || repo.length > 300 || !/^[a-z\d_.-]+\/[a-z\d_.-]+$/i.test(repo) || repo.split('/').some(part => part === '.' || part === '..')) throw new Error('INVALID_GITHUB_REPOS')
  return { key: repo.toLowerCase(), repo, href: `https://github.com/${repo}` }
}

function repository(value) {
  if (typeof value !== 'string' || value.length > 300 || !/^https:\/\//.test(value)) throw new Error('INVALID_GITHUB_REPOS')
  const url = new URL(value)
  if (url.hostname !== 'github.com' || url.username || url.password || url.port || url.search || url.hash) throw new Error('INVALID_GITHUB_REPOS')
  const repo = url.pathname.replace(/\/$/, '').replace(/\.git$/, '').slice(1)
  return repositoryPath(repo)
}

export function dashboardGithubRepositories(env) {
  const raw = String(env.DASHBOARD_GITHUB_REPOS || '')
  if (raw.length > 4000) throw new Error('INVALID_GITHUB_REPOS')
  const rows = raw.split(',').map(value => value.trim()).filter(Boolean)
  const repos = new Map()
  for (const value of rows) {
    const row = repository(value.startsWith('https://') ? value : `https://github.com/${value}`)
    repos.set(row.key, row)
  }
  if (repos.size > 5) throw new Error('INVALID_GITHUB_REPOS')
  return [...repos.values()]
}

export function dashboardGithubOrganization(env) {
  const raw = String(env.DASHBOARD_GITHUB_ORG || '').trim()
  if (!raw) return ''
  let name = raw
  if (raw.startsWith('https://')) {
    const url = new URL(raw)
    if (url.hostname !== 'github.com' || url.username || url.password || url.port || url.search || url.hash) throw new Error('INVALID_GITHUB_ORG')
    name = url.pathname.replace(/\/$/, '').slice(1)
  }
  if (!/^[a-z\d_.-]{1,100}$/i.test(name) || ['.', '..'].includes(name)) throw new Error('INVALID_GITHUB_ORG')
  return name
}

function exclusions(env, org) {
  const raw = String(env.DASHBOARD_GITHUB_EXCLUDE_REPOS || '')
  if (raw.length > 16000) throw new Error('INVALID_GITHUB_EXCLUSIONS')
  return new Set(raw.split(',').map(value => value.trim()).filter(Boolean).map(value => {
    const source = repository(value.startsWith('https://') ? value : `https://github.com/${value}`)
    if (org && source.repo.split('/')[0].toLowerCase() !== org.toLowerCase()) throw new Error('INVALID_GITHUB_EXCLUSIONS')
    return source.key
  }))
}

function peopleMap(raw) {
  const result = new Map()
  if (!raw) return result
  if (typeof raw !== 'string' || raw.length > 16000) throw new Error('INVALID_GITHUB_PEOPLE')
  const rows = JSON.parse(raw)
  if (!Array.isArray(rows) || rows.length > 100) throw new Error('INVALID_GITHUB_PEOPLE')
  for (const person of rows) {
    if (!person || typeof person.name !== 'string' || !person.name.trim() || person.name.length > 100 || person.name.includes('@') || !Array.isArray(person.accounts) || !person.accounts.length || person.accounts.length > 20 || Object.keys(person).some(key => !['name', 'accounts'].includes(key))) throw new Error('INVALID_GITHUB_PEOPLE')
    for (const account of person.accounts) {
      if (typeof account !== 'string' || account.length > 300 || !/^(login|author|email):[^\s].*$/u.test(account)) throw new Error('INVALID_GITHUB_PEOPLE')
      const key = account.replace(/^login:(.*)$/, (_, name) => `login:${name.toLowerCase()}`).replace(/^email:(.*)$/, (_, email) => `email:${email.toLowerCase()}`)
      if (result.has(key) && result.get(key) !== person.name.trim()) throw new Error('INVALID_GITHUB_PEOPLE')
      result.set(key, person.name.trim())
    }
  }
  return result
}

function identity(person, mappings, scope = '') {
  const login = typeof person.login === 'string' && /^[a-z\d_.-]+(?:\[bot\])?$/i.test(person.login) ? person.login : ''
  const author = typeof person.name === 'string' ? person.name.trim() : ''
  const email = typeof person.email === 'string' ? person.email.trim().toLowerCase() : ''
  if (!login && !author && !email) throw new Error('INVALID_CODE_PERSON')
  const keys = [login && `login:${login.toLowerCase()}`, email && `email:${email}`, author && `author:${author}`].filter(Boolean)
  const names = [...new Set(keys.map(key => mappings.get(key)).filter(Boolean))]
  if (names.length > 1) throw new Error('CONFLICTING_CODE_PERSON')
  const memberName = names[0] || ''
  return {
    identity: memberName ? `member:${memberName}` : login ? `login:${login.toLowerCase()}` : email ? `email:${email}` : `${scope}:author:${author}`,
    memberName, login, name: memberName || cleanName(author, login || '未匹配作者'),
    avatar: safeDashboardUrl(person.avatar_url), href: login ? `https://github.com/${login}` : ''
  }
}

function githubAction(event) {
  const action = event.payload?.action
  if (event.type === 'PushEvent') return '推送了代码'
  if (event.type === 'PullRequestEvent') return action === 'opened' ? '打开了合并请求' : action === 'reopened' ? '重新打开了合并请求' : action === 'closed' ? event.payload?.pull_request?.merged ? '合并了代码' : '关闭了合并请求' : ''
  if (event.type === 'IssuesEvent') return ({ opened: '打开了事项', closed: '关闭了事项', reopened: '重新打开了事项' })[action] || ''
  if (event.type === 'IssueCommentEvent' && action === 'created') return '发表了评论'
  if (event.type === 'ReleaseEvent' && action === 'published') return '发布了版本'
  if (event.type === 'CreateEvent') return '创建了仓库内容'
  return ''
}

// 一次响应最多等待8秒、同时最多4个GitHub请求；下一次轮询从未轮到的任务继续。
export function createDashboardGithub({ json, now = Date.now, budgetMs = 8000, concurrency = 4 } = {}) {
  const scopes = new Map()
  return async env => {
    let org, configured, excluded, mappings
    try {
      org = dashboardGithubOrganization(env)
      configured = org ? [] : dashboardGithubRepositories(env)
      excluded = exclusions(env, org)
      if (!org && !configured.length) return empty()
      mappings = peopleMap(env.DASHBOARD_GITHUB_PEOPLE)
    } catch { return { ...empty(), enabled: true, unavailable: true, configurationError: true } }
    const scope = JSON.stringify([org.toLowerCase(), configured.map(row => row.key), [...excluded].sort(), env.DASHBOARD_GITHUB_TOKEN || '', env.DASHBOARD_GITHUB_PEOPLE || ''])
    if (!scopes.has(scope)) {
      if (scopes.size >= 4) scopes.delete(scopes.keys().next().value)
      scopes.set(scope, { cache: new Map(), pending: new Map(), cursor: 0 })
    }
    const state = scopes.get(scope)
    if (!state.readPending) state.readPending = read(env, org, configured, excluded, mappings, state).finally(() => { state.readPending = undefined })
    return state.readPending
  }

  async function read(env, org, configured, excluded, mappings, state) {
    const { cache, pending } = state
    const headers = { 'User-Agent': 'SDUT-Vinci-Dashboard', Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
    if (env.DASHBOARD_GITHUB_TOKEN) headers.Authorization = `Bearer ${env.DASHBOARD_GITHUB_TOKEN}`
    const ttl = env.DASHBOARD_GITHUB_TOKEN ? 10 * 60_000 : 30 * 60_000
    const controller = new AbortController()
    let rejectBudget
    const interrupted = new Promise((_, reject) => { rejectBudget = reject })
    const timer = setTimeout(() => {
      rejectBudget(new Error('SYNC_BUDGET_EXCEEDED'))
      controller.abort()
    }, budgetMs)
    const snapshot = entry => entry && entry.at !== undefined && now() - entry.at > MAX_AGE ? { ...entry, value: null, at: undefined } : entry
    async function request(url) {
      const signal = controller.signal
      if (env.DASHBOARD_GITHUB_TOKEN && !/^[\x21-\x7e]{1,4096}$/.test(env.DASHBOARD_GITHUB_TOKEN)) throw new Error('INVALID_TOKEN_FORMAT')
      if (!signal) throw new Error('ABORT_SIGNAL_UNSUPPORTED')
      if (signal.aborted) throw new Error('SYNC_BUDGET_EXCEEDED')
      return Promise.race([json(url, { headers, signal, redirect: 'manual' }), interrupted])
    }
    async function cached(key, load) {
      const entry = cache.get(key)
      if (entry && now() < entry.next) return snapshot(entry)
      let stage = 'REQUEST'
      if (!pending.has(key)) pending.set(key, Promise.resolve().then(() => load(value => { stage = value })).then(value => {
        const fresh = { value, at: now(), next: now() + ttl, unavailable: false }
        cache.set(key, fresh)
        return fresh
      }).catch(error => {
        const stale = entry && entry.at !== undefined && now() - entry.at <= MAX_AGE
        const failed = { value: stale ? entry.value : null, at: stale ? entry.at : undefined, next: now() + 60_000, unavailable: true, reason: diagnostic(error), failureStage: stage }
        cache.set(key, failed)
        return failed
      }).finally(() => pending.delete(key)))
      return pending.get(key)
    }

    try {
      let repos = configured, discovery
      if (org) {
        discovery = await cached('organization', async markStage => {
          const found = new Map(), seenPages = new Set(), ids = new Map()
          // 上限仅防止上游无限分页；超过时明确失败，不使用前10000项伪装完整列表。
          for (let page = 1; page <= 100; page++) {
            markStage('REQUEST')
            const value = await request(`${API}/orgs/${encodeURIComponent(org)}/repos?type=public&per_page=100&page=${page}`)
            markStage('PARSE')
            if (!Array.isArray(value) || value.length > 100) throw new Error('INVALID_ORGANIZATION_REPOS')
            const pageKeys = []
            for (const row of value) {
              if (!row || typeof row.private !== 'boolean') throw new Error('INVALID_ORGANIZATION_REPO')
              // 即使配置了能读私有仓库的令牌，也只展示组织公开仓库。
              if (row.private) continue
              const source = repositoryPath(row.full_name)
              if (source.repo.split('/')[0].toLowerCase() !== org.toLowerCase()) throw new Error('INVALID_ORGANIZATION_NAMESPACE')
              if (row.fork !== undefined && typeof row.fork !== 'boolean') throw new Error('INVALID_ORGANIZATION_REPO')
              pageKeys.push(source.key)
              if (row.id !== undefined) {
                if (!Number.isSafeInteger(row.id) || row.id < 0) throw new Error('INVALID_ORGANIZATION_REPO')
                const previous = ids.get(row.id)
                if (previous) found.delete(previous)
                ids.set(row.id, source.key)
              }
              found.set(source.key, { ...source, fork: Boolean(row.fork) })
            }
            if (value.length < 100) return [...found.values()].sort((a, b) => a.key.localeCompare(b.key))
            const signature = JSON.stringify(pageKeys.sort())
            if (seenPages.has(signature)) throw new Error('INVALID_ORGANIZATION_PAGINATION')
            seenPages.add(signature)
          }
          throw new Error('ORGANIZATION_REPO_LIMIT')
        })
        repos = discovery.value || []
      }
      if (!org) {
        const verified = []
        for (const source of repos) {
          const metadata = await cached(`${source.key}:metadata`, async markStage => {
            const value = await request(`${API}/repos/${source.repo}`)
            markStage('PARSE')
            if (value?.private !== false || typeof value.full_name !== 'string' || value.full_name.toLowerCase() !== source.key) throw new Error('PUBLIC_REPOSITORY_REQUIRED')
            return { ...source, fork: Boolean(value.fork) }
          })
          if (!metadata.value) return { ...empty(), enabled: true, unavailable: true, configurationError: true }
          verified.push(metadata.value)
        }
        repos = verified
      }
      const discoveredCount = repos.length
      repos = repos.filter(source => !excluded.has(source.key))
      const organization = org ? {
        name: org, href: `https://github.com/${org}`, unavailable: discovery.unavailable,
        authenticated: Boolean(env.DASHBOARD_GITHUB_TOKEN), reason: discovery.reason, failureStage: discovery.failureStage,
        updatedAt: discovery.at, discoveredCount: discovery.value ? discoveredCount : undefined,
        includedCount: discovery.value ? repos.length : undefined, excludedCount: discovery.value ? discoveredCount - repos.length : undefined
      } : undefined
      const liveKeys = new Set(repos.flatMap(source => [`${source.key}:people`, `${source.key}:events`, `${source.key}:metadata`]))
      for (const key of cache.keys()) if (key !== 'organization' && !liveKeys.has(key)) cache.delete(key)
      const jobs = repos.flatMap(source => ['people', 'events'].map(kind => ({ source, kind })))
      let taken = 0
      const start = state.cursor % Math.max(1, jobs.length)
      async function worker() {
        while (taken < jobs.length && !controller.signal.aborted) {
          const index = (start + taken++) % jobs.length
          state.cursor = (index + 1) % jobs.length
          const { source, kind } = jobs[index]
          const base = `${API}/repos/${source.repo}`
          await cached(`${source.key}:${kind}`, async markStage => {
            if (kind === 'people') {
              const people = new Map(), signatures = new Set()
              for (let page = 1; page <= 100; page++) {
                markStage('REQUEST')
                const value = await request(`${base}/contributors?per_page=100&page=${page}`)
                markStage('PARSE')
                // GitHub 在空仓库返回 204，由 json() 规范化为空数组。
                if (!Array.isArray(value) || value.length > 100 || value.some(person => !person || !Number.isSafeInteger(person.contributions) || person.contributions < 0 || typeof person.login !== 'string')) throw new Error('INVALID_CONTRIBUTORS')
                for (const person of value) {
                  const row = identity(person, mappings, source.key)
                  people.set(row.identity, { ...row, count: person.contributions })
                }
                if (value.length < 100) return [...people.values()]
                const signature = JSON.stringify(value.map(person => person.login.toLowerCase()).sort())
                if (signatures.has(signature)) throw new Error('INVALID_CONTRIBUTOR_PAGINATION')
                signatures.add(signature)
              }
              throw new Error('CONTRIBUTOR_LIMIT_EXCEEDED')
            }
            const value = await request(`${base}/events?per_page=20`)
            markStage('PARSE')
            if (!Array.isArray(value)) throw new Error('INVALID_CODE_EVENTS')
            return value.slice(0, 20).flatMap((event, index) => {
              if (!event || event.public === false) return []
              const action = githubAction(event)
              const at = Date.parse(event.created_at)
              if (!action || !Number.isFinite(at) || at > now() + 60_000) return []
              const actor = identity({ login: event.actor?.login }, mappings)
              const eventId = /^[a-z\d_-]+$/i.test(String(event.id || '')) ? event.id : `${at}:${index}`
              const number = event.payload?.pull_request?.number || event.payload?.issue?.number
              const kind = event.type === 'PullRequestEvent' ? 'pull' : event.type === 'IssuesEvent' || event.type === 'IssueCommentEvent' ? 'issues' : ''
              const href = kind && Number.isSafeInteger(number) && number > 0 ? `${source.href}/${kind}/${number}` : source.href
              return [{ id: `${source.key}:${eventId}`, repo: source.repo, actor: actor.name,
                actorLogin: actor.login || '', actorHref: actor.href || source.href, action, at, href }]
            })
          })
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker))
      const people = new Map(), events = [], sources = []
      for (const source of repos) {
        const rows = snapshot(cache.get(`${source.key}:people`)), recent = snapshot(cache.get(`${source.key}:events`))
        const stamps = [rows?.at, recent?.at].filter(Number.isFinite)
        sources.push({ key: source.key, repo: source.repo, href: source.href, fork: source.fork,
          pending: !rows || !recent || rows.next <= now() || recent.next <= now(), unavailable: Boolean(rows?.unavailable || recent?.unavailable),
          contributionsUnavailable: !rows || rows.unavailable, eventsUnavailable: !recent || recent.unavailable,
          contributionsReason: rows?.reason, eventsReason: recent?.reason,
          contributionsFailureStage: rows?.failureStage, eventsFailureStage: recent?.failureStage,
          authorContributions: rows?.value ? rows.value.reduce((sum, person) => sum + person.count, 0) : undefined,
          authorCount: rows?.value?.length, eventCount: recent?.value?.length,
          updatedAt: stamps.length ? Math.min(...stamps) : undefined })
        for (const person of rows?.value || []) {
          const existing = people.get(person.identity)
          if (existing) {
            existing.count += person.count
            if (!existing.avatar) existing.avatar = person.avatar
            if (!existing.href) existing.href = person.href
          } else people.set(person.identity, { ...person, href: person.href || source.href })
        }
        events.push(...recent?.value || [])
      }
      const stamps = sources.map(source => source.updatedAt).filter(Number.isFinite)
      return {
        enabled: true, unavailable: Boolean(discovery?.unavailable || sources.some(source => source.unavailable)),
        syncing: sources.some(source => source.pending), organization, sources,
        updatedAt: stamps.length ? Math.min(...stamps) : undefined,
        contributors: [...people.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 8)
          .map(({ identity: _identity, ...person }, index) => ({ ...person, key: `github-person-${index + 1}` })),
        events: events.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id)).slice(0, 20)
      }
    } finally { clearTimeout(timer) }
  }
}
