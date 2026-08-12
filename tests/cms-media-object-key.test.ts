import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  createCmsMediaContentHash,
  createCmsMediaObjectKey,
  resolveCmsMediaArticleDate
} from '../server/utils/cms-media-object-key'

describe('CMS 图片对象 key', () => {
  it('使用文章分类和创建日期作为目录，保留 Unix 毫秒和内容哈希文件名', () => {
    const output = Buffer.from('final-webp-bytes')
    const now = new Date('2026-08-03T01:02:03.456Z')
    const expectedHash = createHash('sha256').update(output).digest('hex')

    expect(createCmsMediaContentHash(output)).toBe(expectedHash)
    expect(createCmsMediaObjectKey(
      'site-assets/images',
      'wiki',
      ['2025', '02', '07'],
      output,
      now
    )).toBe(
      `site-assets/images/wiki/2025/02/07/${now.getTime()}-${expectedHash.slice(0, 8)}.webp`
    )
  })

  it('内容或上传毫秒变化时生成不同 key', () => {
    const now = new Date('2026-08-03T01:02:03.456Z')
    const first = createCmsMediaObjectKey('images', 'wiki', ['2025', '02', '07'], Buffer.from('first'), now)
    const second = createCmsMediaObjectKey('images', 'wiki', ['2025', '02', '07'], Buffer.from('second'), now)
    const later = createCmsMediaObjectKey(
      'images',
      'wiki',
      ['2025', '02', '07'],
      Buffer.from('first'),
      new Date(now.getTime() + 1)
    )

    expect(first).not.toBe(second)
    expect(first).not.toBe(later)
  })

  it('拒绝无效时间，避免生成不可追踪路径', () => {
    expect(() => createCmsMediaObjectKey(
      'images',
      'wiki',
      ['2025', '02', '07'],
      Buffer.from('image'),
      new Date(Number.NaN)
    )).toThrow('CMS_MEDIA_TIMESTAMP_INVALID')
  })

  it('已有文章优先使用路径日期，新草稿使用发布时间覆盖值并最终回退创建日', () => {
    expect(resolveCmsMediaArticleDate({
      publishedAt: '2024-03-30T08:00:00.000+08:00',
      _vinciPublishedAtOverride: '2025-02-07T01:02:03.000+08:00'
    }, new Date('2026-08-12T00:00:00.000Z'), '2023-10-09-电路教程/index.md'))
      .toEqual(['2023', '10', '09'])

    expect(resolveCmsMediaArticleDate({
      publishedAt: '2024-03-30T08:00:00.000+08:00',
      _vinciPublishedAtOverride: '2025-02-07T01:02:03.000+08:00'
    }, new Date('2026-08-12T00:00:00.000Z'))).toEqual(['2025', '02', '07'])

    expect(resolveCmsMediaArticleDate({}, new Date('2026-08-12T23:00:00.000Z')))
      .toEqual(['2026', '08', '12'])
  })
})
