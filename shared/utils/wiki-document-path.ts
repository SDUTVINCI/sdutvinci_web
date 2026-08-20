export const WIKI_DOCUMENT_NAME_MAX_LENGTH = 180

const canonicalDatePattern = /^\d{4}-\d{2}-\d{2}$/
const datePrefixedNamePattern = /^\d{4}-\d{2}-\d{2}-/
const invalidNameCharactersPattern = /[\\/\u0000-\u001f\u007f]/

export type WikiDocumentPathValidation =
  | {
      valid: true
      date: string
      name: string
      directory: string
      relativePath: string
    }
  | {
      valid: false
      code: 'DATE_REQUIRED' | 'DATE_INVALID' | 'NAME_REQUIRED' | 'NAME_TOO_LONG'
        | 'NAME_INVALID' | 'NAME_REPEATS_DATE'
      message: string
    }

export const isCanonicalWikiDocumentDate = (value: string) => {
  if (!canonicalDatePattern.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year!, month! - 1, day!))
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month! - 1
    && parsed.getUTCDate() === day
}

export const validateWikiDocumentPath = (
  rawDate: string,
  rawName: string
): WikiDocumentPathValidation => {
  const date = rawDate.trim()
  const name = rawName.trim()
  if (!date) {
    return { valid: false, code: 'DATE_REQUIRED', message: '请选择资料日期' }
  }
  if (!isCanonicalWikiDocumentDate(date)) {
    return { valid: false, code: 'DATE_INVALID', message: '资料日期不是有效的公历日期' }
  }
  if (!name) {
    return { valid: false, code: 'NAME_REQUIRED', message: '请填写资料名称' }
  }
  if (name.length > WIKI_DOCUMENT_NAME_MAX_LENGTH) {
    return {
      valid: false,
      code: 'NAME_TOO_LONG',
      message: `资料名称不能超过 ${WIKI_DOCUMENT_NAME_MAX_LENGTH} 个字符`
    }
  }
  if (name === '.' || name === '..' || invalidNameCharactersPattern.test(name)) {
    return {
      valid: false,
      code: 'NAME_INVALID',
      message: '资料名称不能包含斜杠、反斜杠或控制字符'
    }
  }
  if (datePrefixedNamePattern.test(name)) {
    return {
      valid: false,
      code: 'NAME_REPEATS_DATE',
      message: '资料名称不要重复填写日期，日期会自动添加到目录前面'
    }
  }

  const directory = `${date}-${name}`
  return {
    valid: true,
    date,
    name,
    directory,
    relativePath: `${directory}/index.md`
  }
}

export const parseWikiDocumentDirectory = (rawDirectory: string) => {
  const directory = rawDirectory.trim()
  const match = directory.match(/^(\d{4}-\d{2}-\d{2})-(.+)$/)
  if (!match) return null
  const validation = validateWikiDocumentPath(match[1]!, match[2]!)
  return validation.valid ? validation : null
}
