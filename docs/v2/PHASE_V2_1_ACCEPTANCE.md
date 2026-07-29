# V2 阶段 1：正式 Revision 数据模型与安全回填——实施与验收

## 1. 当前状态

- 实现状态：阶段 1 实现完成。
- 自动化验证状态：全部通过。
- 人工验收状态：维护者已验收通过。
- 是否允许进入下一阶段：是；本次收尾未开始阶段 2，需由维护者另行要求。

## 2. 本阶段范围

本阶段以 expand-only Migration 建立不可变正式 Revision 数据模型，并提供默认只读的回填工具。回填把现有 `articles` 稳定 UUID 与当前代码仓库 Markdown 一一对应，在单一数据库事务中创建首个 Revision 和设置 `current_revision_id`。

本阶段继续保持 V1 Git-first 发布、Git 历史、恢复 API、Nuxt Content 和前台读取不变；不接入独立内容仓库写权限。

## 3. 实现内容

### 3.1 Schema

- 新增 `article_revisions`。
- `articles.current_revision_id` 可空并以 `ON DELETE RESTRICT` 引用 Revision。
- `drafts.base_revision_id` 可空并以 `ON DELETE RESTRICT` 引用 Revision。
- 保留 `articles.content_hash`、`articles.frontmatter`、`drafts.base_content_hash` 等全部 V1 兼容字段。
- Revision 保存完整 Markdown 原文字节、解析正文、完整 Frontmatter、SHA-256、来源类型及发布/审核/恢复关联预留字段。
- `(article_id, revision_number)` 唯一；版本号、哈希格式和来源类型有数据库检查约束。
- 业务服务只允许查询或插入 Revision，没有 UPDATE/DELETE 正文路径。

### 3.2 回填

新增：

```bash
npm run v2:revisions:backfill -- --dry-run
npm run v2:revisions:backfill -- \
  --apply --confirm=BACKFILL_ARTICLE_REVISIONS
```

规则：

1. 不传参数等价于 `--dry-run`。
2. Dry Run 只读文件和数据库，不运行 Migration、不更新索引或 Revision。
3. 实际回填必须提供 `--apply` 和固定确认参数。
4. 先按 `(collection, relative_path)` 把文件映射到现有 `articles.id`；该 UUID 同时作为未来 `vinciId`。
5. 活跃文章必须有文件，且文件 SHA-256 必须等于 V1 `articles.content_hash`。
6. 未建索引文件、活跃文章缺失文件、哈希漂移、指针损坏或既有 Revision 冲突都会阻止全部写入。
7. 已删除或 V1 标记为不存在的行明确报告并跳过，不从当前工作树猜测历史正文。
8. 实际写入取得 PostgreSQL advisory transaction lock，并按稳定顺序锁定文章行。
9. 每个文件在事务内再次读取和校验；任何一项变化或失败都会回滚全部 Revision 和指针。
10. 重复回填识别完全相同的首个/当前 Revision，不生成重复记录。
11. 回填只设置新指针，不改变 V1 文章 `updated_at` 或其他旧字段，不改写 Markdown。

### 3.3 测试与备份

- 新增空库 Migration 重放和模拟 V1 有数据升级测试。
- 新增 Dry Run 无写入、完整内容、幂等、冲突、删除/缺失、现有首版接续和事务回滚测试。
- 对仓库全部 228 篇新闻/Wiki 执行回填并逐篇验证 SHA-256。
- CMS 测试清理显式包含 `article_revisions`。
- 备份恢复演练增加 Revision、文章当前指针和草稿基线指针的恢复检查。

## 4. 修改文件

| 文件 | 作用 |
| --- | --- |
| `server/db/schema.ts` | Revision 表及两个可空指针 |
| `server/db/migrations/0011_thankful_proteus.sql` | expand-only Migration |
| `server/db/migrations/meta/0011_snapshot.json` | Drizzle Schema snapshot |
| `server/db/migrations/meta/_journal.json` | Migration journal |
| `server/services/v2-article-revision-backfill.ts` | 只读计划和事务回填服务 |
| `scripts/v2-backfill-article-revisions.ts` | 安全 CLI |
| `tests/v2-revision-backfill.integration.test.ts` | 阶段 1 集成测试 |
| `tests/cms-*.integration.test.ts` | 显式清理新表 |
| `tests/backup-restore.integration.sh` | Revision 备份恢复断言 |
| `scripts/test-cms.sh` | 纳入阶段 1 测试 |
| `package.json` | 阶段 1 命令 |
| `docs/ARCHITECTURE.md` | 记录已实现 Schema，不改变 V1 权威说明 |
| `docs/CODEX_HANDOVER_V2.md` | 追加阶段 1 交接 |
| `docs/v2/VINCI_CONTENT_ARCHITECTURE_V2_REQUIREMENTS.md` | 只勾选真实完成项 |

## 5. 数据库变更

### 5.1 新表

`article_revisions`：

| 列 | 类型 | 可空 | 说明 |
| --- | --- | --- | --- |
| `id` | uuid | 否 | PK，随机 UUID |
| `article_id` | uuid | 否 | 对应稳定文章 UUID |
| `revision_number` | integer | 否 | 每篇从 1 开始 |
| `markdown_source` | text | 否 | 完整 Markdown 原文 |
| `body` | text | 否 | Frontmatter 后的原始正文 |
| `frontmatter` | jsonb | 否 | 完整解析结果 |
| `content_hash` | varchar(64) | 否 | 原文 UTF-8 SHA-256 |
| `source_kind` | varchar(32) | 否 | 当前回填为 `backfill` |
| `source_draft_id` | uuid | 是 | 后续发布来源 |
| `published_by_user_id` | uuid | 是 | 后续发布者 |
| `reviewed_by_user_id` | uuid | 是 | 后续审核者 |
| `restored_from_revision_id` | uuid | 是 | 后续恢复来源 |
| `created_at` | timestamptz | 否 | 插入时间 |

### 5.2 新列

- `articles.current_revision_id uuid null`
- `drafts.base_revision_id uuid null`

旧应用不需要写两个新列，因此 Migration 与当前蓝绿旧版本兼容。Migration 不回填、不删除、不重命名旧列，也不改变现有数据。

## 6. API 变更

无。没有增加或修改 Nitro API；前台、CMS 发布、历史和恢复仍使用 V1 路径。

## 7. 依赖和环境变量

- 新增依赖：无。
- 锁文件变化：无。
- 新增环境变量：无。
- CLI 使用现有 `DATABASE_URL` 和 `CMS_CONTENT_ROOT`。
- 自动化测试只从经过名称安全检查的 `TEST_DATABASE_URL` 派生 `DATABASE_URL`。

## 8. 架构决定

1. 阶段 1 Revision 是未来权威模型的 expand 基础，但尚未成为前台或发布权威。
2. 回填来源是当前代码仓库 `content/news` 和 `content/wiki`；members 留到阶段 9。
3. 首次回填严格复用 `articles.id`，不按标题或路径生成第二 UUID。
4. 已删除/缺失内容不从 Git 历史自动猜测，保持指针可空并进入报告。
5. 完整 Markdown 是哈希对象；Frontmatter 和正文是可查询副本。
6. 同内容恢复未来仍可产生新版本，因此只约束文章内版本号，不对内容哈希做唯一约束。
7. 回填不修改 `updated_at`，避免 V1 列表出现非内容更新时间变化。
8. 阶段 2 前，发布与恢复不会自动追加 Revision；这是一项明确的阶段边界。

## 9. 自动化验证结果

最终验证完成后在这里记录所有命令和结果。

### 测试环境

- 本地隔离 PostgreSQL 17 容器，随机映射到 loopback 端口。
- 临时数据库名称均含 `test`；空库/V1 Migration 测试创建临时数据库并在 finally 删除。
- 内容兼容测试只读本仓库 `content/`。
- Git/S3 使用现有测试替身或无效地址。

### 必须执行

```bash
TEST_DATABASE_URL='<isolated-test-url>' npm run test:v2:phase1
TEST_DATABASE_URL='<isolated-test-url>' npm run test:cms
npm run test:backup-restore
./tests/auto-deploy.integration.sh
./tests/install-auto-deploy.integration.sh
./tests/deploy-cache-cleanup.integration.sh
npm run wiki:check
npm run typecheck
npm run build
git diff --check
```

附加检查：

- CLI Dry Run、apply、缺确认拒绝。
- Drizzle Migration 和 snapshot 一致性。
- 全部 228 篇正式文章哈希一致。
- `server/` 无 Revision UPDATE/DELETE 业务路径。
- 无生产凭据、内容仓库写操作或运行时内容源差异。

### 最终验证结果

- `TEST_DATABASE_URL='<isolated-test-url>' npm run test:v2:phase1`：1 个文件、
  9 项通过；实际执行而非 skip。
- `TEST_DATABASE_URL='<isolated-test-url>' npm run test:cms`：9 个文件、
  50 项通过。
- CLI 首次 Dry Run：228 个文件、228 个索引、228 个待创建、0 blocker。
- CLI 首次 apply：创建 228 个 Revision、链接 228 篇文章、0 blocker。
- CLI 第二次 Dry Run 和第二次 apply：228 个 `alreadyBackfilled`、创建 0、
  链接 0、0 blocker。
- CLI 缺少 `--confirm=BACKFILL_ARTICLE_REVISIONS`：退出码 2，按预期拒绝。
- `npm run test:backup-restore`：通过；包含校验和、空目标恢复、前向
  Migration、Revision 原文/哈希、当前/基线指针、应用健康、非空目标拒绝和卷隔离。
- `./tests/auto-deploy.integration.sh`：通过。
- `./tests/install-auto-deploy.integration.sh`：通过。
- `./tests/deploy-cache-cleanup.integration.sh`：通过。
- `npm run wiki:check`：226 个 Wiki 文件通过。
- `npm run typecheck`：通过。
- `npm run build`：通过；保留基线已有的 6 个 `/images/*` 运行时解析 warning。
- `npm exec -- drizzle-kit check`：Migration journal 与 snapshot 一致。
- 修改过的 Shell 及相关运维测试脚本 `bash -n`：通过。
- 阶段 1 运行时边界限定 diff：发布、恢复、API、前台、`content/`、Docker、
  systemd 和 GitHub Actions 无变化。
- `git diff --check`：通过。

### 验证中发现并修复

- 一次专用测试误传 `DATABASE_URL`，被测试数据库护栏全部 skip；该次不计为
  通过，随后改用名称含 `test` 的 `TEST_DATABASE_URL`，9 项实际执行并通过。
- 备份恢复新增夹具最初依赖 `psql --command` 多行变量，并在同一
  data-modifying CTE 中插入后更新文章；分别暴露变量不展开和同语句快照不可见。
  已改为标准输入和顺序 `DO` 块，并在最终完整演练中通过。

### 生产资源

未连接生产数据库、生产 S3/COS、生产服务器或内容仓库写端点。没有 Push、部署或发布真实镜像。

## 10. 安全检查

- CLI 默认 Dry Run，实际写入要求双参数确认。
- CLI 不自动运行 Migration，避免 Dry Run 隐式写数据库。
- 回填只接受路径安全工具解析的 news/wiki Markdown。
- 哈希不一致、未知文件、缺失文件和损坏指针 fail closed。
- 全量写入在 advisory lock 和单一事务中完成。
- 报告不含数据库连接串、密码、Token 或私钥。
- Revision 正文业务层无 UPDATE/DELETE。
- 内容仓库没有被访问写端点，也没有新增凭据。

## 11. 已知限制

- 阶段 1 只回填 news/wiki；成员 Revision 属于阶段 9。
- 已删除或当前缺失文章不会自动从 Git 历史回填，保持 `current_revision_id` 可空。
- 文件系统不能参加 PostgreSQL 锁；工具通过事务前计划、advisory lock、文章行锁及事务内二次读取降低并发风险。执行回填时仍应暂停内容发布。
- 阶段 2 前的新发布和恢复不会追加 Revision，Git 仍是正式权威。
- `source_draft_id`、发布者、审核者和恢复来源在首次回填中为空。
- CLI 只输出 JSON 到 stdout；长期报告保留和轮转属于后续运维阶段。

## 12. 回滚方法

### 12.1 应用回滚

阶段 1 是 expand-only。旧应用可忽略新表和可空列，优先做应用 Commit 回滚而不执行 down migration：

```bash
git revert <阶段1-commit-sha>
```

如果数据库已经执行 `0011`，允许保留新表和列；回滚后的 V1 应用仍可运行。不要自动删除 Revision。

### 12.2 测试环境 Schema 清理

只有维护者明确确认、数据库备份完成、且确认没有阶段 2 数据时，才可在隔离环境手工：

```sql
alter table drafts drop constraint if exists drafts_base_revision_id_article_revisions_id_fk;
alter table articles drop constraint if exists articles_current_revision_id_article_revisions_id_fk;
alter table drafts drop column if exists base_revision_id;
alter table articles drop column if exists current_revision_id;
drop table if exists article_revisions;
```

生产环境不提供或自动执行不可逆 down migration。

### 12.3 回填失败

单次 apply 失败会自动回滚数据库事务。先保存 JSON 报告，修复索引/文件差异，再重新 Dry Run；不要删除已存在 Revision 或改写 Markdown 来规避冲突。

## 13. 人工验收准备

- 使用隔离 PostgreSQL 17，数据库名含 `test`。
- 使用本 Commit 的代码和只读内容目录。
- 不配置生产 Git、S3/COS 或服务器凭据。
- 确保 `npm ci` 已完成，Docker/Node 版本符合仓库要求。
- 验收前停止隔离环境的内容编辑和发布任务。

## 14. 人工验收步骤

### 14.1 核对提交范围

```bash
git show --stat --oneline <阶段1-commit-sha>
git diff <阶段1-commit-sha>^ <阶段1-commit-sha> -- \
  app server/api server/services/cms-publishing.ts \
  server/services/cms-publishing-history.ts content docker systemd
```

预期：

- 只有本验收文档列出的 Schema、Migration、回填、测试和文档变化。
- 发布、恢复、前台、content、Docker 和 systemd 无行为修改。

失败：不要继续回填；记录意外 diff 并交回修复。

### 14.2 验证 Migration

在空隔离库执行：

```bash
DATABASE_URL='<isolated-test-url>' npm run db:migrate
```

预期：

- 有 `article_revisions`。
- 两个新指针可空。
- 空库没有自动 Revision。

在 V1 数据快照副本执行同一命令，预期旧文章、草稿、用户和发布记录数量不变。失败时丢弃隔离库，从快照重建；不要对生产数据库调试。

### 14.3 同步 V1 索引并执行 Dry Run

仅在隔离库：

```bash
DATABASE_URL='<isolated-test-url>' \
CMS_CONTENT_ROOT='<stage1-worktree>/content' \
npm run cms:content:sync

DATABASE_URL='<isolated-test-url>' \
CMS_CONTENT_ROOT='<stage1-worktree>/content' \
npm run v2:revisions:backfill -- --dry-run \
  > /tmp/vinci-v2-phase1-dry-run.json
```

检查：

```bash
node -e "
const r=require('/tmp/vinci-v2-phase1-dry-run.json')
console.log(r.summary)
"
```

预期：228 个正式 Markdown、228 个活跃文章、228 个待创建 Revision、0 blocker。若数量不同，不执行 apply；检查是否使用正确 Commit、内容根和隔离数据库。

### 14.4 实际回填和幂等验证

```bash
DATABASE_URL='<isolated-test-url>' \
CMS_CONTENT_ROOT='<stage1-worktree>/content' \
npm run v2:revisions:backfill -- \
  --apply --confirm=BACKFILL_ARTICLE_REVISIONS \
  > /tmp/vinci-v2-phase1-apply.json

DATABASE_URL='<isolated-test-url>' \
CMS_CONTENT_ROOT='<stage1-worktree>/content' \
npm run v2:revisions:backfill -- --dry-run \
  > /tmp/vinci-v2-phase1-second-dry-run.json
```

首次预期：created 228、linked 228、blockers 0。第二次预期：alreadyBackfilled 228、create 0、blockers 0。

失败：事务失败时查询确认 Revision 和指针没有半写；保留报告，不要删除冲突 Revision。

### 14.5 抽查原文

在数据库分别抽查一篇新闻、普通 Wiki 和含 `<NuxtLink>`/HTML/include 的 Wiki：

```sql
select
  a.collection,
  a.relative_path,
  a.id = r.article_id as stable_id_ok,
  a.current_revision_id = r.id as pointer_ok,
  r.revision_number,
  r.content_hash,
  length(r.markdown_source) as source_chars,
  length(r.body) as body_chars,
  r.frontmatter
from articles a
join article_revisions r on r.id = a.current_revision_id
order by a.collection, a.relative_path;
```

再对导出的 `markdown_source` 使用 `sha256sum` 与源文件比较。预期完整字节、Frontmatter、未知语法和 SHA 一致。

### 14.6 验证 V1 行为

- 浏览前台新闻、Wiki 和团队。
- 登录 CMS，查看文章、创建草稿、提交、审核。
- 在测试 Git 仓库发布和恢复一篇测试文章。
- 确认仍使用 Git-first、Git 历史和 Nuxt Content。
- 确认阶段 1 没有写独立内容仓库。

### 14.7 验证备份恢复

```bash
npm run test:backup-restore
```

预期：恢复后的 Revision 原文、文章当前指针和草稿基线指针一致；非空目标继续拒绝恢复。

### 14.8 给出结论

全部通过后明确回复：

```text
V2 阶段 1 验收通过
```

维护者已于 2026-07-29 明确验收通过；本次只记录验收结果，未开始阶段 2。

## 15. 人工验收预期结果

- expand Migration 对空库和 V1 数据库安全。
- 228 篇文章一一对应稳定 UUID 和首个 Revision。
- 完整原文、正文、Frontmatter、SHA 和指针一致。
- 重复执行无重复数据。
- 失败无半写。
- V1 前台、CMS、发布、历史和恢复不变。
- 独立内容仓库未写入。

## 16. 人工验收记录

- 验收结论：通过。
- 维护者确认时间：2026-07-29。
- 实现 Commit：`42ca85976552fe483b80afd9050e99fd28422b2c`。
- 验收修复 Commit：无实现修复；本次文档收尾 Commit 由最终回复报告。
- 维护者确认原文：`V2 阶段 1 验收通过`

## 17. 下一阶段注意事项

- 已收到明确验收原文；阶段 2 仍需维护者另行要求后才开始。
- 阶段 2 只在 Git push 成功后的数据库事务中影子追加 Revision。
- 阶段 2 必须更新 `drafts.base_revision_id`，但继续保留 `base_content_hash`。
- Git push 失败不得产生 Revision；恢复产生新 Revision，不覆盖历史。
- 内容仓库继续只读且不接入。
