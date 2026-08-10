import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('CMS 手动全量导出入口', () => {
  it('只允许管理员携带 CSRF 提交，并由 Worker 异步领取', async () => {
    const [route, page, worker, migration] = await Promise.all([
      readFile('server/api/cms/content-reconciliation/request.post.ts', 'utf8'),
      readFile('app/pages/cms/index.vue', 'utf8'),
      readFile('scripts/v2-content-export-worker.ts', 'utf8'),
      readFile('server/db/migrations/0019_tan_black_cat.sql', 'utf8')
    ])
    expect(route).toContain("requireCmsRequestAuth(event, 'admin')")
    expect(route).toContain('requireCmsCsrf(event, auth)')
    expect(page).toContain('v-if="isAdmin"')
    expect(page).toContain('手动全量导出')
    expect(worker).toContain('runNextRequestedContentReconciliation')
    expect(migration).toContain('content_reconciliation_requests')
  })
})
