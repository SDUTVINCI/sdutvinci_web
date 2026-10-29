import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp, toNodeListener } from 'h3'

const { sessionUser, readDashboard } = vi.hoisted(() => ({
  sessionUser: vi.fn(),
  readDashboard: vi.fn()
}))

vi.mock('../server/services/cms-auth', () => ({ getCmsSessionUser: sessionUser }))
vi.mock('../server/utils/cms-config', () => ({
  getCmsServerConfig: () => ({ CMS_SESSION_COOKIE: 'vinci_cms_session', CMS_SECURE_COOKIES: false })
}))
vi.mock('../utils/dashboard-service.mjs', () => ({ createDashboardService: () => readDashboard }))

import dashboardHandler from '../server/api/dashboard.get'

describe('看板 HTTP 接口使用网站会话', () => {
  let server: Server
  let url: string

  beforeAll(async () => {
    server = createServer(toNodeListener(createApp().use('/api/dashboard', dashboardHandler)))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/dashboard`
  })
  afterAll(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  })
  beforeEach(() => {
    vi.clearAllMocks()
    sessionUser.mockResolvedValue(null)
    readDashboard.mockImplementation(() => Response.json({ tasks: [{ id: 'private-task' }] }))
  })

  const expectPrivate = (response: Response) => {
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('vary')).toBe('Cookie')
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
  }

  it('匿名、旧共享口令和伪造 Cookie 均返回 401，不能读取已缓存的任务', async () => {
    // 模拟上游已经存在缓存；路由必须在调用读取服务之前拒绝匿名请求。
    for (const headers of [
      {},
      { Authorization: 'Bearer old-dashboard-code' },
      { Cookie: 'vinci_cms_session=forged', 'X-Authenticated': 'true' }
    ]) {
      const response = await fetch(`${url}?authenticated=true&DASHBOARD_PUBLIC=true`, { headers })
      expect(response.status).toBe(401)
      expectPrivate(response)
      expect(await response.text()).not.toContain('private-task')
    }
    expect(readDashboard).not.toHaveBeenCalled()
    expect(sessionUser).toHaveBeenCalledExactlyOnceWith('forged')
  })

  it.each(['admin', 'member', 'reader'])('有效的 %s 登录账号直接读取，无需额外口令', async role => {
    sessionUser.mockImplementation(async token => token === 'valid-session'
      ? { id: 'user', account: 'test-user', status: 'active', roles: [role] } : null)
    const response = await fetch(url, { headers: { Cookie: 'vinci_cms_session=valid-session' } })
    expect(response.status).toBe(200)
    expectPrivate(response)
    expect(await response.json()).toEqual({ tasks: [{ id: 'private-task' }] })
    expect(readDashboard).toHaveBeenCalledWith(expect.objectContaining({ authenticated: true }))
  })

  it('每次请求重新验证会话；退出、过期或停用后立即拒绝并清除失效 Cookie', async () => {
    sessionUser.mockResolvedValueOnce({ id: 'user', roles: ['member'] }).mockResolvedValue(null)
    const headers = { Cookie: 'vinci_cms_session=revoked-session' }
    expect((await fetch(url, { headers })).status).toBe(200)
    const expired = await fetch(url, { headers })
    expect(expired.status).toBe(401)
    expectPrivate(expired)
    expect(expired.headers.get('set-cookie')).toContain('vinci_cms_session=;')
    expect(await expired.text()).not.toContain('private-task')
    expect(sessionUser).toHaveBeenCalledTimes(2)
    expect(readDashboard).toHaveBeenCalledTimes(1)
  })
})
