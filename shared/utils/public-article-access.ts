export const PUBLIC_ARTICLE_AUTH_REQUIRED_CODE = 'ARTICLE_AUTH_REQUIRED'

const asRecord = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object'
    ? value as Record<string, unknown>
    : null
)

export const isPublicArticleAuthRequiredError = (error: unknown) => {
  const outer = asRecord(error)
  const response = asRecord(outer?.data)
  const detail = asRecord(response?.data)
  const status = Number(
    outer?.statusCode
    ?? outer?.status
    ?? response?.statusCode
    ?? response?.status
  )
  const code = outer?.code ?? response?.code ?? detail?.code

  return status === 401 && code === PUBLIC_ARTICLE_AUTH_REQUIRED_CODE
}
