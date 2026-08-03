import { describe, expect, it } from 'vitest'
import {
  appendContentHash,
  createCdnPublicUrl
} from '../scripts/prepare-cdn-media'

describe('静态媒体上传包路径', () => {
  it('保留可读文件名并追加内容哈希', () => {
    expect(appendContentHash('张益豪.jpg', 'a3f91c2e12345678', '.webp'))
      .toBe('张益豪-a3f91c2e.webp')
    expect(appendContentHash('backgroundvideo.mp4', '1234567890abcdef', '.mp4'))
      .toBe('backgroundvideo-12345678.mp4')
  })

  it('逐段编码 CDN 对象 key，不破坏目录结构', () => {
    expect(createCdnPublicUrl(
      'https://cdn.sdutvincirobot.top/',
      'site-assets/images/member_photo/张益豪-a3f91c2e.webp'
    )).toBe(
      'https://cdn.sdutvincirobot.top/site-assets/images/member_photo/%E5%BC%A0%E7%9B%8A%E8%B1%AA-a3f91c2e.webp'
    )
  })
})
