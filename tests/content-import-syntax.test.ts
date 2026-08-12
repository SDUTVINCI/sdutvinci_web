import { describe, expect, it } from 'vitest'
import { addedSyntaxWarnings } from '../server/utils/content-import-syntax'

describe('PR 新增高风险语法检测', () => {
  it('旧文已有 HTML、Vue、MDC 时，普通正文修改不误报', () => {
    const base = '<Notice tone="info">旧文字</Notice>\n\n::gallery\n旧说明\n::\n'
    const proposed = '<Notice tone="info">新文字</Notice>\n\n::gallery\n新说明\n::\n'
    expect(addedSyntaxWarnings(base, proposed)).toEqual([])
  })

  it('只报告 PR 相对 Base 新增的风险结构', () => {
    expect(addedSyntaxWarnings(
      '<Notice>已有</Notice>\n',
      '<Notice>已有</Notice>\n<iframe src="https://example.com"></iframe>\n::tabs\n'
    )).toEqual(['RAW_HTML_OR_VUE', 'EXECUTABLE_HTML', 'MDC_OR_VUE'])
  })

  it('新增文章扫描全文，代码围栏和行内代码不计入', () => {
    const proposed = '```html\n<script>alert(1)</script>\n```\n`<Widget />`\n正文\n'
    expect(addedSyntaxWarnings('', proposed)).toEqual([])
    expect(addedSyntaxWarnings('', '<Widget />\n')).toEqual(['RAW_HTML_OR_VUE'])
  })

  it('增加同一种既有结构的出现次数仍算新增风险', () => {
    expect(addedSyntaxWarnings('<Widget />\n', '<Widget />\n<Widget />\n'))
      .toEqual(['RAW_HTML_OR_VUE'])
  })

  it('修改既有标签属性、脚本内容或 MDC 参数仍算新写入风险', () => {
    expect(addedSyntaxWarnings('<Widget tone="old" />\n', '<Widget tone="new" />\n'))
      .toEqual(['RAW_HTML_OR_VUE'])
    expect(addedSyntaxWarnings('<script>old()</script>\n', '<script>new()</script>\n'))
      .toEqual(['EXECUTABLE_HTML'])
    expect(addedSyntaxWarnings('::card{tone="old"}\n', '::card{tone="new"}\n'))
      .toContain('MDC_OR_VUE')
  })
})
