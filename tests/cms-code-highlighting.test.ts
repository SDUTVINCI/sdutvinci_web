import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { parse } from 'comark'
import {
  createVinciMarkdownPlugins,
  vinciMarkdownOptions
} from '../shared/utils/vinci-markdown'

describe('CMS 编辑器代码高亮', () => {
  it.each(['bash', 'cpp', 'python', 'typescript', 'json', 'yaml', 'sql'])(
    '源码编辑器可加载 %s 围栏语言',
    async (name) => {
      const description = LanguageDescription.matchLanguageName(languages, name, true)
      expect(description).toBeDefined()
      await expect(description!.load()).resolves.toBeDefined()
    }
  )

  it('源码与富文本编辑器均定义高对比深浅配色且不改正式渲染器', async () => {
    const [sourceEditor, visualEditor, visualUtils, styles, renderer] = await Promise.all([
      readFile('app/components/cms/CmsMarkdownSourceEditor.client.vue', 'utf8'),
      readFile('app/components/cms/CmsMarkdownVisualEditor.client.vue', 'utf8'),
      readFile('app/utils/cms-visual-editor.ts', 'utf8'),
      readFile('app/assets/css/cms.css', 'utf8'),
      readFile('app/components/VinciMarkdownRenderer.vue', 'utf8')
    ])

    expect(sourceEditor).toContain('markdown({ codeLanguages: languages })')
    expect(sourceEditor).toContain('syntaxHighlighting(cmsSyntaxHighlighting)')
    expect(styles).toContain(':root[data-theme="dark"] .cms-codemirror-shell .cm-editor')
    expect(styles).toContain('.cms-milkdown-root .milkdown .milkdown-code-block')
    expect(styles).toContain('background: #edf2f0')
    expect(styles).toContain(':root[data-theme="dark"] .cms-milkdown-root .milkdown .milkdown-code-block')
    expect(visualEditor).toContain('createCmsVisualEditorFeatureConfigs')
    expect(visualUtils).toContain('cmsVisualCodeMirrorTheme')
    expect(visualUtils).toContain('[Crepe.Feature.CodeMirror]')
    expect(renderer).toContain(':options="vinciMarkdownOptions"')
    expect(renderer).toContain('className = \'code-toolbar\'')
    expect(renderer).toContain('@click="handleRendererClick"')
  })

  it('Shiki 深色 token 明确覆盖内联的 GitHub Light 颜色', async () => {
    const wikiStyles = await readFile('app/assets/css/wiki.css', 'utf8')
    expect(wikiStyles).toContain('color: var(--shiki-dark) !important')
    expect(wikiStyles).toContain('background-color: var(--shiki-dark-bg) !important')
    expect(wikiStyles).toContain(':root:not([data-theme="light"]) .wiki-content-body .shiki span')
  })

  it.each(['cpp', 'c', 'python', 'rust', 'go', 'java', 'csharp', 'bash', 'sql'])(
    '发布渲染器为 %s 生成 GitHub 深浅双色 token',
    async (language) => {
      const fence = '`'.repeat(3)
      const tree = await parse(`${fence}${language}\nconst value = 42; // Vinci\n${fence}`, {
        ...vinciMarkdownOptions,
        plugins: createVinciMarkdownPlugins()
      })
      const serialized = JSON.stringify(tree.nodes)
      expect(serialized).toContain('shiki shiki-themes github-light github-dark')
      expect(serialized).toContain('--shiki-dark:')
      expect(serialized).toContain('class":"line')
    }
  )
})
