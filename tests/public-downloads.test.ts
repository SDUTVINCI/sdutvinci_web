import { describe, expect, it, vi } from 'vitest'
import {
  listPublicDownloads,
  parsePublicDownloadPath,
  PublicDownloadsError
} from '../server/services/public-downloads'

describe('公开资料目录', () => {
  it('只读取 /vdl 内的目录，并为文件生成编码后的 AList 直链', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({
      code: 200,
      data: {
        content: [
          { name: '机器人 资料.pdf', is_dir: false, size: 2048, modified: '2026-09-26T10:00:00Z' },
          { name: '赛季文件', is_dir: true, size: 0, modified: '2026-09-25T10:00:00Z' }
        ],
        total: 2,
        has_more: false
      }
    }), { status: 200 })) as typeof fetch

    const result = await listPublicDownloads('2026 赛季', 1, request)
    expect(request).toHaveBeenCalledWith('https://dl.sdutvinci.cn/api/fs/list',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          path: '/vdl/2026 赛季', password: '', page: 1, per_page: 200, refresh: false
        })
      }))
    expect(result.entries).toEqual([
      expect.objectContaining({ name: '赛季文件', path: '2026 赛季/赛季文件', downloadUrl: null }),
      expect.objectContaining({
        name: '机器人 资料.pdf',
        downloadUrl: 'https://dl.sdutvinci.cn/d/vdl/2026%20%E8%B5%9B%E5%AD%A3/%E6%9C%BA%E5%99%A8%E4%BA%BA%20%E8%B5%84%E6%96%99.pdf'
      })
    ])
  })

  it('拒绝目录穿越与无效页码', async () => {
    expect(() => parsePublicDownloadPath('../private')).toThrow(PublicDownloadsError)
    expect(() => parsePublicDownloadPath('/private')).toThrow(PublicDownloadsError)
    expect(() => parsePublicDownloadPath('folder\\private')).toThrow(PublicDownloadsError)
    await expect(listPublicDownloads('', 0)).rejects.toThrow('无效的页码')
  })

  it('访客访问关闭时返回明确提示', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({
      code: 401,
      message: 'Guest user is disabled, login please'
    }), { status: 200 })) as typeof fetch
    await expect(listPublicDownloads('', 1, request))
      .rejects.toThrow('资料目录尚未开放访客读取')
  })
})
