const secretEnvironmentKeys = [
  'CMS_AUTH_SECRET',
  'DATABASE_URL',
  'POSTGRES_PASSWORD',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'CMS_GIT_REMOTE_URL',
  'CONTENT_EXPORT_REMOTE_URL',
  'CONTENT_EXPORT_SSH_KEY_FILE',
  'CONTENT_EXPORT_KNOWN_HOSTS_FILE',
  'CONTENT_PR_IMPORT_GITHUB_TOKEN',
  'CONTENT_PR_BRANCH_CLEANUP_GITHUB_TOKEN',
  'CONTENT_PR_IMPORT_API_URL',
  'GITHUB_TOKEN',
  'GH_TOKEN'
] as const

const replaceAllLiteral = (
  source: string,
  search: string,
  replacement: string
) => search ? source.split(search).join(replacement) : source

export const redactCmsSensitiveText = (value: unknown) => {
  let text = String(value)

  for (const key of secretEnvironmentKeys) {
    const secret = process.env[key]
    if (secret && secret.length >= 4) {
      text = replaceAllLiteral(text, secret, `[REDACTED_${key}]`)
    }
  }

  return text
    .replace(
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
      '[REDACTED_PRIVATE_KEY]'
    )
    .replace(
      /\b(https?:\/\/)([^/\s:@]+):([^@\s/]+)@/gi,
      '$1[REDACTED_CREDENTIALS]@'
    )
    .replace(
      /\b(authorization\s*:\s*(?:bearer|basic)\s+)[^\s,;]+/gi,
      '$1[REDACTED_TOKEN]'
    )
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[REDACTED_ACCESS_KEY]')
}

export const describeCmsFailure = (error: unknown, maxLength = 4000) => {
  if (error instanceof Error) {
    const stderr = 'stderr' in error && typeof error.stderr === 'string'
      ? error.stderr.trim()
      : ''
    return redactCmsSensitiveText(
      `${error.message}${stderr ? `：${stderr}` : ''}`
    ).slice(0, maxLength)
  }
  return redactCmsSensitiveText(error).slice(0, maxLength)
}
