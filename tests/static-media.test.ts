import { parse } from 'comark'
import { describe, expect, it } from 'vitest'
import {
  registeredStaticMediaPaths,
  resolveStaticMediaUrl
} from '../shared/utils/static-media'
import {
  createVinciMarkdownPlugins,
  vinciMarkdownOptions
} from '../shared/utils/vinci-markdown'

describe('仓库静态媒体 CDN 兼容映射', () => {
  it('映射已有路径、编码路径和 URL 后缀，未知内容保持原样', () => {
    const expected = 'https://cdn.sdutvincirobot.top/site-assets/images/member_photo/%E5%BC%A0%E7%9B%8A%E8%B1%AA-d5952078.webp'
    expect(resolveStaticMediaUrl('/images/member_photo/张益豪.jpg')).toBe(expected)
    expect(resolveStaticMediaUrl('/images/member_photo/%E5%BC%A0%E7%9B%8A%E8%B1%AA.jpg?v=1#photo'))
      .toBe(`${expected}?v=1#photo`)
    expect(resolveStaticMediaUrl('/images/future-file.png')).toBe('/images/future-file.png')
    expect(resolveStaticMediaUrl('https://example.com/image.png')).toBe('https://example.com/image.png')
    expect(registeredStaticMediaPaths).toHaveLength(57)
  })

  it('最终 Markdown 渲染只改写登记资源属性，不修改代码和未知路径', async () => {
    const tree = await parse(`![登记图片](/images/joinus.jpg)

<img src="/images/member_photo/张益豪.jpg?size=small">

![未知图片](/images/future-file.png)

\`/images/joinus.jpg\``, {
      ...vinciMarkdownOptions,
      plugins: createVinciMarkdownPlugins()
    })
    const serialized = JSON.stringify(tree.nodes)
    expect(serialized).toContain('joinus-1ff5973e.webp')
    expect(serialized).toContain('%E5%BC%A0%E7%9B%8A%E8%B1%AA-d5952078.webp?size=small')
    expect(serialized).toContain('/images/future-file.png')
    expect(serialized).toContain('/images/joinus.jpg')
  })
})
