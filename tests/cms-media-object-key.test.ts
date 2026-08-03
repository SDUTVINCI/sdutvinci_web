import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  createCmsMediaContentHash,
  createCmsMediaObjectKey
} from '../server/utils/cms-media-object-key'

describe('CMS 图片对象 key', () => {
  it('使用 UTC 年月、Unix 毫秒和最终文件内容哈希命名', () => {
    const output = Buffer.from('final-webp-bytes')
    const now = new Date('2026-08-03T01:02:03.456Z')
    const expectedHash = createHash('sha256').update(output).digest('hex')

    expect(createCmsMediaContentHash(output)).toBe(expectedHash)
    expect(createCmsMediaObjectKey('images', 'draft-test', output, now)).toBe(
      `images/2026/08/draft-test/${now.getTime()}-${expectedHash.slice(0, 8)}.webp`
    )
  })

  it('内容或上传毫秒变化时生成不同 key', () => {
    const now = new Date('2026-08-03T01:02:03.456Z')
    const first = createCmsMediaObjectKey('images', 'draft-test', Buffer.from('first'), now)
    const second = createCmsMediaObjectKey('images', 'draft-test', Buffer.from('second'), now)
    const later = createCmsMediaObjectKey(
      'images',
      'draft-test',
      Buffer.from('first'),
      new Date(now.getTime() + 1)
    )

    expect(first).not.toBe(second)
    expect(first).not.toBe(later)
  })

  it('拒绝无效时间，避免生成不可追踪路径', () => {
    expect(() => createCmsMediaObjectKey(
      'images',
      'draft-test',
      Buffer.from('image'),
      new Date(Number.NaN)
    )).toThrow('CMS_MEDIA_TIMESTAMP_INVALID')
  })
})
