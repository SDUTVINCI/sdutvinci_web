import { describe, expect, it } from 'vitest'
import {
  isCanonicalWikiDocumentDate,
  parseWikiDocumentDirectory,
  validateWikiDocumentPath
} from '../shared/utils/wiki-document-path'

describe('Wiki 主文档目录规则', () => {
  it('由有效日期和不含日期的资料名称生成规范目录及 index.md 路径', () => {
    expect(validateWikiDocumentPath('2021-09-16', 'OpenWrt编译教学')).toEqual({
      valid: true,
      date: '2021-09-16',
      name: 'OpenWrt编译教学',
      directory: '2021-09-16-OpenWrt编译教学',
      relativePath: '2021-09-16-OpenWrt编译教学/index.md'
    })
    expect(parseWikiDocumentDirectory('2021-09-16-OpenWrt编译教学')).not.toBeNull()
  })

  it('拒绝缺少或不真实的日期以及自由目录名', () => {
    expect(validateWikiDocumentPath('', '资料')).toMatchObject({ valid: false, code: 'DATE_REQUIRED' })
    expect(validateWikiDocumentPath('2023-02-29', '资料')).toMatchObject({ valid: false, code: 'DATE_INVALID' })
    expect(validateWikiDocumentPath('2026-2-01', '资料')).toMatchObject({ valid: false, code: 'DATE_INVALID' })
    expect(isCanonicalWikiDocumentDate('2024-02-29')).toBe(true)
    expect(parseWikiDocumentDirectory('111')).toBeNull()
  })

  it('拒绝路径字符、空名称和重复日期前缀', () => {
    expect(validateWikiDocumentPath('2026-08-21', '')).toMatchObject({ valid: false, code: 'NAME_REQUIRED' })
    expect(validateWikiDocumentPath('2026-08-21', 'A/B')).toMatchObject({ valid: false, code: 'NAME_INVALID' })
    expect(validateWikiDocumentPath('2026-08-21', '2021-09-16-OpenWrt编译教学')).toMatchObject({
      valid: false,
      code: 'NAME_REPEATS_DATE'
    })
  })
})
