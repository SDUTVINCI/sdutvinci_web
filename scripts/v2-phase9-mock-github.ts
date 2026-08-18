import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'

const stateRoot = process.env.PHASE9_MANUAL_STATE_ROOT || ''
const port = Number(process.env.PHASE9_MANUAL_MOCK_PORT || '0')
const token = process.env.CONTENT_PR_IMPORT_GITHUB_TOKEN || ''
if (!stateRoot.endsWith('/vinci-v2-phase9-manual-test') || !port || !token) throw new Error('PHASE9_MOCK_CONFIGURATION_INVALID')
const fixture = JSON.parse(await readFile(join(stateRoot, 'fixture.json'), 'utf8')) as {
  repositoryId: string, pullRequestNumber: number, baseCommit: string, headCommit: string,
  files: Array<Record<string, unknown>>, contents: Record<string, string>
}
const stateFile = join(stateRoot, 'pull-state.json')
const actionLog = join(stateRoot, 'external-actions.jsonl')
const json = (response: import('node:http').ServerResponse, status: number, value: unknown) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value))
}
const readBody = async (request: import('node:http').IncomingMessage) => {
  let source = ''
  for await (const chunk of request) { source += String(chunk); if (source.length > 32_768) throw new Error('BODY_TOO_LARGE') }
  return source ? JSON.parse(source) : {}
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://127.0.0.1:${port}`)
    if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, { status: 'ok', scope: 'v2-phase9-manual-test' })
    if (request.headers.authorization !== `Bearer ${token}`) return json(response, 401, { message: 'mock authorization required' })
    const prefix = `/repos/${fixture.repositoryId}`
    if (request.method === 'GET' && url.pathname === `${prefix}/pulls/${fixture.pullRequestNumber}`) {
      const state = JSON.parse(await readFile(stateFile, 'utf8')) as { state: string }
      return json(response, 200, {
        number: fixture.pullRequestNumber, state: state.state, user: { login: 'phase9-local-fixture' },
        base: { sha: fixture.baseCommit, ref: 'main', repo: { full_name: fixture.repositoryId } },
        head: { sha: fixture.headCommit, ref: 'phase9-manual-test', repo: { full_name: fixture.repositoryId } }
      })
    }
    if (request.method === 'GET' && url.pathname === `${prefix}/pulls/${fixture.pullRequestNumber}/files`) {
      const page = Number(url.searchParams.get('page') || '1'); const perPage = Math.min(100, Number(url.searchParams.get('per_page') || '30'))
      return json(response, 200, fixture.files.slice((page - 1) * perPage, page * perPage))
    }
    const contentPrefix = `${prefix}/contents/`
    if (request.method === 'GET' && url.pathname.startsWith(contentPrefix)) {
      const ref = url.searchParams.get('ref') || ''; const path = decodeURIComponent(url.pathname.slice(contentPrefix.length))
      if (![fixture.baseCommit, fixture.headCommit].includes(ref) || !path || path.includes('..') || path.includes('\\') || path.includes('\0')) return json(response, 422, {})
      const source = fixture.contents[`${ref}:${path}`]
      if (source === undefined) return json(response, 404, {})
      const bytes = Buffer.from(source)
      return json(response, 200, { type: 'file', size: bytes.length, encoding: 'base64', content: bytes.toString('base64') })
    }
    if (request.method === 'POST' && url.pathname === `${prefix}/issues/${fixture.pullRequestNumber}/comments`) {
      const input = await readBody(request) as { body?: string }
      await appendFile(actionLog, `${JSON.stringify({ action: 'comment', body: input.body || '' })}\n`, 'utf8')
      return json(response, 201, { id: Date.now() })
    }
    if (request.method === 'PATCH' && url.pathname === `${prefix}/pulls/${fixture.pullRequestNumber}`) {
      const input = await readBody(request) as { state?: string }
      if (input.state !== 'closed') return json(response, 422, {})
      await writeFile(stateFile, '{"state":"closed"}\n', 'utf8')
      await appendFile(actionLog, `${JSON.stringify({ action: 'close' })}\n`, 'utf8')
      return json(response, 200, { state: 'closed' })
    }
    return json(response, 404, {})
  } catch { return json(response, 500, { message: 'mock failure' }) }
}).listen(port, '127.0.0.1')
