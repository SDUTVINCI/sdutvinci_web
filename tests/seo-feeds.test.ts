import { afterEach, describe, expect, it, vi } from 'vitest'

const publicContent = vi.hoisted(() => ({
  listPublicArticlesFromDatabase: vi.fn(),
  listPublicMembersFromDatabase: vi.fn()
}))
vi.mock('../server/services/public-content', () => publicContent)

import { buildPublicDatabaseSitemap, buildPublicDatabaseSitemapText } from '../server/services/public-content-feeds'

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })

describe('SEO 公开网址 Feed', () => {
  it('XML 和文本清单一致，包含组织架构、真实版本时间和转义后的 URL', async () => {
    vi.stubEnv('NUXT_PUBLIC_SITE_URL', 'https://runtime.example')
    publicContent.listPublicArticlesFromDatabase.mockImplementation(async collection => collection === 'news'
      ? [{ path: '/news/robot&team', updatedAt: '2026-10-07T01:00:00Z' }]
      : [{ path: '/wiki/control', updatedAt: '2026-10-06T01:00:00Z' }])
    publicContent.listPublicMembersFromDatabase.mockResolvedValue([
      { path: '/team/member', updatedAt: '2026-10-05T01:00:00Z' }
    ])
    const [xml, text] = await Promise.all([buildPublicDatabaseSitemap(), buildPublicDatabaseSitemapText()])
    expect(xml).toContain('<loc>https://runtime.example/news/robot&amp;team</loc><lastmod>2026-10-07T01:00:00.000Z</lastmod>')
    expect(xml).toContain('<loc>https://runtime.example/team/organization</loc></url>')
    expect(xml).toContain('<loc>https://runtime.example/news</loc><lastmod>2026-10-07T01:00:00.000Z</lastmod>')
    const locations = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]!.replaceAll('&amp;', '&'))
    expect(text.trim().split('\n')).toEqual(locations)
    expect(text).not.toMatch(/\/projects|\/search|\/cms|\/team\/apply/)
    expect(publicContent.listPublicArticlesFromDatabase.mock.calls.every(call => call.length === 1)).toBe(true)
  })

  it('空内容不伪造更新时间，未配置域名时不输出 localhost', async () => {
    vi.stubEnv('NUXT_PUBLIC_SITE_URL', '')
    publicContent.listPublicArticlesFromDatabase.mockResolvedValue([])
    publicContent.listPublicMembersFromDatabase.mockResolvedValue([])
    const xml = await buildPublicDatabaseSitemap()
    expect(xml).not.toContain('<lastmod>')
    expect(xml).not.toContain('localhost')
    expect(xml).toContain('https://vinci.sdut.edu.cn/')
  })
})
