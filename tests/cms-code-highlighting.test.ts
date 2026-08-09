import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

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
    const [sourceEditor, styles, renderer] = await Promise.all([
      readFile('app/components/cms/CmsMarkdownSourceEditor.client.vue', 'utf8'),
      readFile('app/assets/css/cms.css', 'utf8'),
      readFile('app/components/VinciMarkdownRenderer.vue', 'utf8')
    ])

    expect(sourceEditor).toContain('markdown({ codeLanguages: languages })')
    expect(sourceEditor).toContain('syntaxHighlighting(cmsSyntaxHighlighting)')
    expect(styles).toContain(':root[data-theme="dark"] .cms-codemirror-shell .cm-editor')
    expect(styles).toContain('.cms-milkdown-root .milkdown .milkdown-code-block')
    expect(styles).toContain('background: #111a1f')
    expect(renderer).toContain(':options="vinciMarkdownOptions"')
  })
})
