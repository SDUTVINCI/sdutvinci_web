import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { compileScript, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import { createSSRApp, h, type Component } from 'vue'
import { describe, expect, it } from 'vitest'
import { createSearchSnippet, highlightSearchText } from '../shared/utils/public-search'

const require = createRequire(import.meta.url)
const loadStateComponent = async (): Promise<Component> => {
  const source = await readFile('app/components/PublicContentState.vue', 'utf8')
  const { descriptor } = parse(source)
  const script = compileScript(descriptor, { id: 'public-content-state-test', inlineTemplate: true })
  const { outputText } = ts.transpileModule(script.content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS }
  })
  const module = { exports: {} as { default: Component } }
  new Function('require', 'module', 'exports', outputText)(require, module, module.exports)
  return module.exports.default
}

describe('搜索摘要与安全高亮', () => {
  it('将大小写不同的重复命中拆成文本，按字面匹配正则特殊字符', () => {
    expect(highlightSearchText('Robocon 与 ROBOCON', ' robocon ')).toEqual([
      { text: 'Robocon', match: true },
      { text: ' 与 ', match: false },
      { text: 'ROBOCON', match: true }
    ])
    expect(highlightSearchText('C++ 与 C+；[电机]', 'C++').filter(part => part.match))
      .toEqual([{ text: 'C++', match: true }])
    expect(highlightSearchText('[电机]', '[电机]')).toEqual([{ text: '[电机]', match: true }])
    expect(highlightSearchText('正文', ' ')).toEqual([{ text: '正文', match: false }])
  })

  it('保持 HTML 输入为普通文本，避免把关键词和正文作为 HTML 渲染', () => {
    const text = '<img src=x onerror=alert(1)>机器人'
    expect(highlightSearchText(text, '<img').map(part => part.text).join('')).toBe(text)
    expect(highlightSearchText(text, '<img')[0]).toEqual({ text: '<img', match: true })
  })

  it('正文深处的命中带上下文且摘要长度受限', () => {
    const snippet = createSearchSnippet(`${'背景介绍。'.repeat(100)}电机调试步骤${'接下来的实践。'.repeat(100)}`, '电机')
    expect(snippet).toContain('电机调试步骤')
    expect(snippet.startsWith('…')).toBe(true)
    expect(snippet.endsWith('…')).toBe(true)
    expect(snippet.length).toBeLessThanOrEqual(242)
  })

  it('较长关键词仍完整保留在摘要中', () => {
    const keyword = '机器人'.repeat(66)
    expect(createSearchSnippet(`${'介绍'.repeat(100)}${keyword}结束`, keyword)).toContain(keyword)
  })

  it('清理 Markdown 外观，同时保留代码块里的可搜索命令', () => {
    const snippet = createSearchSnippet('# 环境配置\n[官网](https://example.test)\n```bash\npip install robot\n```\n<img src="x">', 'pip')
    expect(snippet).toBe('环境配置 官网 pip install robot')
    expect(createSearchSnippet('', '电机')).toBe('')
    expect(createSearchSnippet('没有匹配的正文', '电机')).toBe('没有匹配的正文')
  })
})

describe('公共内容加载状态', () => {
  it('加载时不显示旧错误、重试或空状态', async () => {
    const component = await loadStateComponent()
    const html = await renderToString(createSSRApp({ render: () => h(component, {
      pending: true, error: true, loadingMessage: '正在搜索…', emptyMessage: '没有结果'
    }) }))
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('正在搜索…')
    expect(html).not.toContain('没有结果')
    expect(html).not.toContain('重新加载')
  })

  it('请求失败显示可重试的错误，不误报为空', async () => {
    const component = await loadStateComponent()
    const html = await renderToString(createSSRApp({ render: () => h(component, {
      error: true, errorMessage: '新闻读取失败', emptyMessage: '还没有新闻内容'
    }) }))
    expect(html).toContain('role="alert"')
    expect(html).toContain('新闻读取失败')
    expect(html).toContain('重新加载')
    expect(html).not.toContain('还没有新闻内容')
  })

  it('真正为空才显示空状态，外部关键词作为文本转义', async () => {
    const component = await loadStateComponent()
    const html = await renderToString(createSSRApp({ render: () => h(component, {
      emptyMessage: '没有找到 <script>alert(1)</script>'
    }) }))
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('重新加载')
  })
})
