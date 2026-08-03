import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createSSRApp, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { Comark } from '@comark/vue'
import { parse } from 'comark'
import { describe, expect, it } from 'vitest'
import { buildV2ComarkCompatibilityReport } from '../scripts/v2-comark-audit'
import {
  createVinciMarkdownPlugins,
  protectVinciTemplateTokens,
  vinciMarkdownOptions
} from '../shared/utils/vinci-markdown'

describe('V2 阶段 3 Comark、CodeMirror 与最终预览', () => {
  it('独立内容仓库全部现有 Markdown 都能由 Comark 扫描并生成逐文件报告', async () => {
    const report = await buildV2ComarkCompatibilityReport()
    expect(report.summary).toMatchObject({
      scanned: 260,
      rendered: 260,
      renderFailures: 0
    })
    expect(report.files).toHaveLength(260)
    expect(report.files.every(file => file.sourceHash.length === 64)).toBe(true)
  }, 120_000)

  it('标题 ID、目录、GFM、NuxtLink、MDC、HTML、代码和图片进入统一 AST', async () => {
    const tree = await parse(protectVinciTemplateTokens(`# 标题

## 中文 标题

- [x] 完成

| A | B |
| - | - |
| 1 | 2 |

<NuxtLink to="/wiki/test">站内链接</NuxtLink>

::notice
MDC 内容
::

<div class="legacy">原始 HTML</div>

\`\`\`ts
const ok = true
\`\`\`

![图片](/images/test.png)
`), {
      ...vinciMarkdownOptions,
      plugins: createVinciMarkdownPlugins()
    })
    const serialized = JSON.stringify(tree)
    expect(serialized).toContain('"id":"中文-标题"')
    expect(serialized).toContain('"table"')
    expect(serialized).toContain('"nuxtlink"')
    expect(serialized).toContain('"notice"')
    expect(serialized).toContain('"legacy"')
    expect(serialized).toContain('"class":"shiki shiki-themes')
    expect(serialized).toContain('/images/test.png')
    expect((tree.meta.toc as any).links).toMatchObject([
      { id: '中文-标题', text: '中文 标题', depth: 2 }
    ])
  })

  it('未知模板语法在预览中可见，不会被 Comark 静默删除', async () => {
    const ordinary = '# 普通 Markdown\n\n正文 **加粗** 与 [链接](/wiki)。'
    expect(protectVinciTemplateTokens(ordinary)).toBe(ordinary)

    const source = '前文\n\n{% include unknown.html %}\n\n{{ unknown.value }}'
    const prepared = protectVinciTemplateTokens(source)
    const tree = await parse(prepared, {
      ...vinciMarkdownOptions,
      plugins: createVinciMarkdownPlugins()
    })
    expect(JSON.stringify(tree)).toContain('{% include unknown.html %}')
    expect(JSON.stringify(tree)).toContain('{{ unknown.value }}')
    expect(protectVinciTemplateTokens('`{% include code.html %}`')).toBe(
      '`{% include code.html %}`'
    )
  })

  it('最终预览可以 SSR，并在执行前阻断脚本、事件属性和危险 URL', async () => {
    const source = `# 安全边界

<script>alert('xss')</script>
<img src="javascript:alert(1)" onerror="alert(2)">
<iframe src="https://example.com/embed"></iframe>`
    const plugins = createVinciMarkdownPlugins()
    const tree = await parse(source, { ...vinciMarkdownOptions, plugins })
    const serialized = JSON.stringify(tree)
    expect(serialized).not.toContain('["script"')
    expect(serialized).not.toContain('"onerror"')
    expect(serialized).not.toContain('javascript:')
    expect(serialized).toContain('data-vinci-blocked-tag')
    expect(serialized).toContain('"iframe"')

    const app = createSSRApp({
      render: () => h(Comark, {
        markdown: protectVinciTemplateTokens(source),
        options: vinciMarkdownOptions,
        plugins
      })
    })
    const html = await renderToString(app)
    expect(html).toContain('安全边界')
    expect(html).toContain('data-vinci-blocked-tag="script"')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('onerror=')
  })

  it('CodeMirror 6 状态支持大中文文档、Markdown 高亮语法和中文输入事务', () => {
    const largeDocument = `${'# 大文档\n\n中文内容 **加粗**\n'.repeat(6_000)}`
    const state = EditorState.create({
      doc: largeDocument,
      extensions: [markdown()]
    })
    expect(state.doc.length).toBeGreaterThan(100_000)
    const transaction = state.update({
      changes: { from: state.doc.length, insert: '\n新增中文输入：机器人。' }
    })
    expect(transaction.state.doc.toString().endsWith('新增中文输入：机器人。')).toBe(true)
  })

  it('只删除三个没有模板来源的 section include，不损失教师正文', async () => {
    const files = [
      ['members/teacher/张彦斐.md', '机器视觉与三维场景重构'],
      ['members/teacher/宫金良.md', '特种机器人装备研发'],
      ['members/teacher/巩丽.md', '12号教学楼']
    ] as const
    const sourceRoot = process.env.V2_CONTENT_SNAPSHOT_SOURCE
    expect(sourceRoot, 'V2_CONTENT_SNAPSHOT_SOURCE 必须指向独立内容仓库快照').toBeTruthy()
    for (const [path, retainedText] of files) {
      const source = await readFile(resolve(sourceRoot!, path), 'utf8')
      expect(source).toContain(retainedText)
      expect(source).not.toContain('{% include section.html %}')
    }
  })

  it('草稿页接入富文本单栏、源码双栏预览、CodeMirror 回退和图片插入', async () => {
    const [page, editor] = await Promise.all([
      readFile('app/pages/cms/drafts/[id].vue', 'utf8'),
      readFile('app/components/cms/CmsMarkdownSourceEditor.client.vue', 'utf8')
    ])
    expect(page).toContain("ref<'source' | 'visual'>('source')")
    expect(page).toContain('富文本')
    expect(page).toContain('Markdown 源码与预览')
    expect(page).toContain('cms-source-workspace')
    expect(page).toContain('<VinciMarkdownRenderer :variant="initial.collection" :markdown="body" />')
    expect(page).toContain("if (mode.value === 'source'")
    expect(page).toContain('sourceEditor.value?.insertMarkdown(markdown)')
    expect(page).toContain('appendMarkdown(markdown)')
    expect(page).toContain('@scroll-progress="handleSourceScroll"')
    expect(editor).toContain('basicSetup')
    expect(editor).toContain('EditorView.lineWrapping')
    expect(editor).toContain('<textarea')
    expect(editor).toContain('v-else')
  })
})
