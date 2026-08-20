import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { resolveLegacyDocumentEmbeds } from '../shared/utils/vinci-document-embed'

describe('外部在线文档嵌入', () => {
  it('只在最终渲染前升级旧式飞书全屏 iframe', () => {
    const source = `正文

<div style="width: 100vw; margin-left: calc(-50vw + 50%); padding: 0;">
  <iframe src="https://sdutvincirobot.feishu.cn/wiki/example"
          style="width: 100vw; height: 100vh; border: 0;">
  </iframe>
</div>`

    const result = resolveLegacyDocumentEmbeds(source)
    expect(result).toContain('::vinci-document-embed{')
    expect(result).toContain('src="https://sdutvincirobot.feishu.cn/wiki/example"')
    expect(result).not.toContain('100vw')
    expect(result).not.toContain('<iframe')
  })

  it('不改写其他提供方、不安全协议或普通 HTML', () => {
    const ordinary = '<div><iframe src="https://example.com/embed"></iframe></div>'
    const unsafe = '<div><iframe src="http://team.feishu.cn/wiki/example"></iframe></div>'
    expect(resolveLegacyDocumentEmbeds(ordinary)).toBe(ordinary)
    expect(resolveLegacyDocumentEmbeds(unsafe)).toBe(unsafe)
  })

  it('组件提供按需展开、宽屏、外部打开和移动端适配', async () => {
    const [component, renderer, styles, registry] = await Promise.all([
      readFile('app/components/markdown/VinciDocumentEmbed.vue', 'utf8'),
      readFile('app/components/VinciMarkdownRenderer.vue', 'utf8'),
      readFile('app/assets/css/wiki.css', 'utf8'),
      readFile('shared/utils/vinci-content-components.ts', 'utf8')
    ])

    expect(renderer).toContain('resolveLegacyDocumentEmbeds(props.markdown)')
    expect(renderer).toContain("'vinci-document-embed': VinciDocumentEmbed")
    expect(registry).toContain("id: 'document-embed'")
    expect(component).toContain("window.matchMedia('(max-width: 640px)').matches")
    expect(component).toContain('宽屏查看')
    expect(component).toContain('在{{ provider }}打开')
    expect(component).toContain("event.key === 'Escape'")
    expect(styles).toContain('.vinci-document-dialog-backdrop')
    expect(styles).toContain('height: 100dvh')
  })
})
