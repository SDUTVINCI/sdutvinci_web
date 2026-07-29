# V2 阶段 2：Revision 影子写入、历史和恢复数据库化——实施与验收

## 1. 当前结论

- 实施日期：2026-07-29。
- 最高优先级依据：`docs/v2/VINCI_CONTENT_ARCHITECTURE_V2_REQUIREMENTS.md` 第 18 节。
- 实现状态：完成，自动化验证通过。
- 人工验收：按维护者要求延后，与阶段 3 联合执行；本文件中的人工验收项全部保持未勾选。
- 阶段总体完成：未勾选。
- 阶段推进说明：维护者已明确授权先实施阶段 3，但这不等于阶段 2 验收通过；阶段 2
  仍需按本文与阶段 3 验收文档联合人工验收。
- 生产状态：默认仍为 `CONTENT_PUBLISH_MODE=legacy_git`；未 Push、未部署。

## 2. 基线与范围

阶段 2 从以下已验收基线开始：

- 分支：`main`。
- 起始 HEAD：`383db3152dac6301001c5b8738ee2f17c41e566c`。
- 阶段 1 实现：`42ca85976552fe483b80afd9050e99fd28422b2c`。
- `origin/main`：`1752363a306d9c6bc0b44d1eb8a6ce359444637d`。
- 开始时本地 `main` 比 `origin/main` 领先 5 个提交，工作区干净。
- 没有发现适用的 `AGENT.md` 或 `AGENTS.md`。

本阶段只实现 Git-first 后的 Revision 影子写入、数据库历史/详情/Diff、数据库恢复
影子入口和只读一致性报告。没有切换前台、没有 DB-first、没有接入或写入
`SDUTVINCI/sdutvinci_content`、没有移除 Git 历史或 Nuxt Content。

## 3. 发布事务

在 `CONTENT_PUBLISH_MODE=revision_shadow` 且 `NODE_ENV=test` 时，发布顺序为：

1. 读取已审核草稿和最后一次审核人。
2. 取得现有 CMS Git 发布锁。
3. fetch、校验工作区和草稿基线哈希。
4. 写 Markdown、commit，并 Push 到明确配置的测试远端。
5. 只有 Push 成功后才进入一个数据库事务。
6. 同一事务更新 V1 `articles` 兼容投影。
7. 追加不可变 `article_revisions`。
8. 更新 `articles.current_revision_id`。
9. 更新草稿状态、`base_content_hash` 和 `base_revision_id`。
10. 完成 V1 `publish_records` 并写入包含 `revisionId` 的审计记录。

Git Push 失败发生在第 5 步之前，因此不会创建 Revision，也不会更新草稿基线。
应用仍把 GitHub 故障视为发布失败；阶段 2 没有实现 DB-first 成功降级。

每个 Revision 保存：

- 完整 Markdown、解析正文、完整 Frontmatter 和 SHA-256；
- 发布者、审核者和来源草稿；
- V1 发布操作 UUID；
- Git Commit SHA；
- 单篇文章内单调递增版本号；
- 发布/恢复时间。

`source_operation_id` 唯一，`(article_id, git_commit_hash)` 唯一。追加前锁定文章行，
同一发布操作或同一文章的同一 Git Commit 重试时只允许得到同一 Revision；字段不一致
则 fail closed。

## 4. 恢复、历史与权限

V1 Git 历史 API 全部保留。Git 历史恢复在影子模式下仍先生成并 Push 一个新 Git
Commit，然后在后续数据库事务中追加 `source_kind=restore` 的新 Revision。

新增的数据库影子服务：

| 能力 | HTTP 入口 | 权限 |
| --- | --- | --- |
| 历史列表 | `GET /api/cms/articles/:id/revisions` | 已登录用户 |
| Revision 详情 | `GET /api/cms/articles/:id/revisions/:revision` | 已登录用户 |
| 正文 Diff | `GET /api/cms/articles/:id/revisions/diff?from=<uuid>&to=<uuid>` | 已登录用户 |
| 数据库 Revision 恢复 | `POST /api/cms/articles/:id/revisions/:revision/restore` | 管理员、同源、CSRF |

这些入口只有 `NODE_ENV=test` 和 `CONTENT_PUBLISH_MODE=revision_shadow` 同时满足时才
可见，否则返回 404。普通成员不能调用发布或恢复，也不能绕过既有审核、管理员权限、
同源和 CSRF 校验。

数据库恢复只把所选不可变 Revision 作为待恢复原文；正式顺序仍是 Git commit/Push
成功在先、数据库追加在后。恢复永不 UPDATE 或 DELETE 旧 Revision。

## 5. 数据库变更

Migration：`0012_fuzzy_roxanne_simpson.sql`。

expand-only 变更：

- `article_revisions.source_operation_id uuid null`；
- `article_revisions.git_commit_hash varchar(64) null`；
- `source_operation_id` 到 V1 `publish_records.id` 的 `ON DELETE RESTRICT` 外键；
- `source_operation_id` 唯一索引；
- `(article_id, git_commit_hash)` 唯一索引。

两列保持可空以兼容阶段 1 的 backfill Revision。Migration 不更新旧行、不删除或重命名
旧列、不生成业务 Revision，也没有 down migration。

## 6. 功能开关

新增：

```dotenv
CONTENT_PUBLISH_MODE=legacy_git
```

阶段 2 只接受：

- `legacy_git`：默认，完全保持 V1 发布、历史和恢复行为；
- `revision_shadow`：只允许 `NODE_ENV=test` 的隔离环境；
- `database`：已保留为未来枚举名，但阶段 2明确拒绝。

未知值、生产环境的 `revision_shadow` 和阶段 2 的 `database` 都 fail closed。Compose
显式传递该变量但默认值为 `legacy_git`，因此本阶段没有改变生产部署行为。

## 7. Git/Revision 一致性报告

只读命令：

```bash
NODE_ENV=test \
CONTENT_PUBLISH_MODE=revision_shadow \
DATABASE_URL='<isolated-test-url>' \
CMS_GIT_WORKTREE='<isolated-test-worktree>' \
CMS_GIT_REMOTE_URL='<isolated-test-remote>' \
npm run v2:revisions:compare -- --article-id='<article-uuid>'
```

省略 `--article-id` 时扫描数据库中的全部文章。报告只写标准输出，包含：

- Revision 与 Git Commit 显式或哈希推断的一对一映射；
- Revision 时间与 Git author time 的 5 秒容差检查；
- Frontmatter `authors`；
- Revision 发布者与 V1 publish record 操作者；
- 审核者和来源草稿；
- 解析正文；
- 完整 Markdown 字节和 SHA-256；
- 没有对应 Revision 的 Git Commit；
- mismatch 总数。

退出码：

- `0`：所有 Revision 字段一致，且没有未匹配 Git Commit；
- `1`：发现差异、未匹配提交或运行失败；
- `2`：参数错误。

工具没有 apply、repair、delete、update 或 Push 模式。发现差异时应保存标准输出，停止
切换，人工调查；不得让脚本自动修改生产数据。

本阶段隔离测试文章的最终报告：

- article：1；
- Revision：6；
- mismatch：0；
- unmatched Git Commit：0；
- backfill 首版通过完整 Markdown/SHA 推断到初始 Git Commit；
- 后续发布与恢复通过显式 Commit/operation UUID 一一关联。

已知真实数据差异：阶段 1 只回填每篇文章当时的当前版本，并未把 V2 前的全部 Git
历史逐提交导入数据库。对真实长历史文章运行工具时，旧 Git Commit 可能被报告为
`unmatchedGitCommits`；这是预期的待人工评估差异，不得自动补写或删除。阶段 2 之后在
影子模式产生的发布/恢复应全部显式匹配。

## 8. 自动化验证结果

已通过：

- 阶段 2 专用：1 个文件、7 项测试；
- 完整 CMS：10 个文件、57 项测试；
- 全新隔离数据库 Migration 重放；
- V1 Git-first 发布、Push 失败、历史和恢复回归；
- Revision 成功单写、并发、成功后重试和失败后重试；
- Git Push 失败零 Revision；
- Git 恢复和数据库恢复均追加历史；
- DB 与 Git 正文 Diff 一致；
- 历史排序、详情、当前指针和草稿基线；
- 发布者、审核者、来源草稿、审计和 API 权限；
- 一致性服务及真实 CLI；
- 空库备份恢复、forward Migration、应用健康和非空目标拒绝；
- 自动部署、自动部署安装和部署缓存清理回归；
- `npm run typecheck`。

最终 `npm run build`、`git diff --check` 和提交前全量复验结果在本阶段提交前写入
交接记录；只有命令实际通过后才勾选权威需求中的对应项。

## 9. 已知限制

1. 阶段 2 不解决 Git Push 成功但随后数据库永久不可用的跨系统原子性；只有数据库事务
   也成功后 API 才返回发布成功。Git/DB 对账用于暴露此类孤立 Git Commit，不能自动修复。
2. backfill Revision 没有 `source_operation_id` 和 `git_commit_hash`；工具只能按完整
   原文和 SHA 做一对一推断。
3. 历史 API 只供测试环境对比，前台和正式 CMS 展示仍使用 Git 入口。
4. `legacy_git` 模式不会追加 Revision；切回该模式是阶段 2 的显式回滚策略。
5. 报告当前只写 stdout。持久报告目录、保留期限和自动清理属于后续统一运维阶段；人工
   保存报告时必须使用受控测试目录并按本地策略清理，禁止无限堆积。
6. 成员内容不在本阶段；`members` 数据库权威属于阶段 9。

## 10. 回滚方法

### 10.1 应用回滚

使用普通提交回滚：

```bash
git revert '<phase2-commit-sha>'
npm run typecheck
npm run build
git diff --check
```

不得 `git reset --hard`、Force Push 或覆盖维护者后续提交。

### 10.2 配置回滚

隔离测试环境立即设回：

```dotenv
CONTENT_PUBLISH_MODE=legacy_git
```

重新启动测试应用并确认数据库影子 API 返回 404、V1 Git 历史仍可用。不要删除已经成功
写入的 Revision；它们是审计记录，可留给后续分析。

### 10.3 数据库回滚

`0012` 是可由旧应用安全忽略的 expand Migration。首选保留两列、外键和索引，不执行
自动 down migration。

只有在隔离数据库、已备份、确认没有任何阶段 2 Revision，且维护者明确授权时，才可
人工制定删除约束/索引/列的 SQL。生产环境不得照抄临时 down SQL。

### 10.4 Git 回滚

本阶段的恢复本身就是新 Git Commit。若测试发布内容不正确，使用受审核的 Git/DB 恢复
入口再生成一个新提交；不得重写历史或 Force Push。

## 11. 人工验收前置条件

- 使用名称明确含 `test` 的隔离 PostgreSQL 数据库；
- 使用新建的本地 bare Git 测试远端或维护者明确批准的测试仓库；
- 使用单独的 `CMS_GIT_WORKTREE`；
- 不注入生产数据库、生产 Git deploy key、生产 S3/COS 或服务器凭据；
- 备份隔离数据库；
- 确认 `.env` 为 `NODE_ENV=test` 和 `CONTENT_PUBLISH_MODE=revision_shadow`；
- 确认测试文章不是生产内容；
- 保存起始 DB 行数、Git HEAD 和测试路径。

## 12. 详细人工验收步骤

### 12.1 审查提交范围

```bash
git show --stat '<phase2-commit-sha>'
git diff '383db3152dac6301001c5b8738ee2f17c41e566c..<phase2-commit-sha>' -- \
  server scripts tests shared compose.yaml .env.example docs
```

预期：只有阶段 2 Schema/Migration、服务/API、测试、开关和文档；没有
`content/**/*.md`、前台渲染、Nuxt Content 移除、内容仓库、生产 unit 或部署行为切换。

失败处理：发现范围外文件立即停止验收，不要 revert 来源不明改动；先报告文件和 diff。

### 12.2 Migration

```bash
DATABASE_URL='<isolated-test-url>' npm run db:migrate
```

预期：成功创建两列、外键和唯一索引，旧文章/草稿/Revision 数量与内容不变。

验证：

```sql
select column_name, is_nullable
from information_schema.columns
where table_name = 'article_revisions'
  and column_name in ('source_operation_id', 'git_commit_hash')
order by column_name;

select indexname
from pg_indexes
where tablename = 'article_revisions'
  and indexname in (
    'article_revisions_source_operation_unique',
    'article_revisions_article_git_commit_unique'
  )
order by indexname;
```

失败处理：保存错误，确认 URL 指向隔离库；不要清空库、删除旧 Revision 或改生产 Schema。

### 12.3 首次影子发布

启动测试应用前确认：

```bash
test "$NODE_ENV" = test
test "$CONTENT_PUBLISH_MODE" = revision_shadow
git -C "$CMS_GIT_WORKTREE" remote -v
git -C "$CMS_GIT_WORKTREE" status --short
```

在 CMS 创建或打开测试文章草稿，提交、由管理员审核，再由管理员发布。

预期：

- 测试远端增加一个 Git Commit；
- 只新增一个 Revision；
- `source_kind=publish`；
- 发布者、审核者、来源草稿和 Commit SHA 正确；
- `articles.current_revision_id` 指向新 Revision；
- 草稿 `base_revision_id` 与之相同；
- publish record 为 succeeded；
- `article.publish` 审计包含 `revisionId`。

可用 SQL：

```sql
select
  r.id,
  r.revision_number,
  r.source_kind,
  r.source_draft_id,
  r.published_by_user_id,
  r.reviewed_by_user_id,
  r.source_operation_id,
  r.git_commit_hash,
  encode(sha256(convert_to(r.markdown_source, 'UTF8')), 'hex') = r.content_hash
    as hash_ok
from article_revisions r
where r.article_id = '<article-uuid>'
order by r.revision_number desc;
```

### 12.4 再次发布和并发

重新进入同一草稿，修改正文、重新提交审核并发布。再用两个测试客户端对同一已审核版本
近同时发起发布请求。

预期：正常再次发布版本号加 1；并发请求最多一个成功，另一请求返回状态/冲突错误；
Git 和数据库均只新增一个正式版本。对成功请求重试不得再生成 Revision。

失败处理：如果出现两个 Revision，立即关闭测试应用、切回 `legacy_git`、保存 DB 和
Git 状态并停止验收；不得删除其中一个来掩盖问题。

### 12.5 Push 失败

只在本地 bare 测试远端安装拒绝 Push 的临时 `pre-receive` hook，或使用明确会拒绝写入
的测试远端。记录失败前 Revision 数量，发布一次。

预期：API 返回 Git 发布失败，草稿保持 approved，publish record 为 failed，Git HEAD
和 Revision 数量不变。

移除测试 hook 后重试。预期只新增一个 Git Commit 和一个 Revision。

安全：绝不能在生产仓库安装测试 hook、撤销生产 key 或修改 branch protection 来制造
失败。

### 12.6 历史、详情和 Diff

以已登录成员读取数据库历史、详情和 Diff；以未登录请求验证 401。确认历史按
`revision_number desc` 排序，详情完整原文/正文/Frontmatter 未丢失。

同时调用保留的 Git 历史/版本/Diff。对同一两个版本使用正文范围比较，预期 added、
removed、same 片段一致。

把 `CONTENT_PUBLISH_MODE` 改回 `legacy_git` 并重启测试应用。预期数据库影子入口为
404，而原 Git 历史仍正常。

### 12.7 Git 恢复和数据库恢复

先通过原 Git 历史入口恢复旧提交：

- 远端产生一个新 Git Commit；
- DB 追加一个 `restore` Revision；
- 旧 Revision 仍存在；
- 能匹配时 `restored_from_revision_id` 指向旧 Revision。

再启用影子模式并通过数据库 Revision 恢复另一旧版：

- 只有管理员、同源、有效 CSRF 可成功；
- Git Push 仍必须先成功；
- DB 再追加一个 `restore` Revision；
- 不覆盖任何旧 Revision。

普通成员调用恢复应为 403；缺 Origin 或 CSRF 应为 403。

### 12.8 一致性报告

```bash
NODE_ENV=test \
CONTENT_PUBLISH_MODE=revision_shadow \
DATABASE_URL='<isolated-test-url>' \
CMS_GIT_WORKTREE='<isolated-worktree>' \
CMS_GIT_REMOTE_URL='<isolated-remote>' \
npm run v2:revisions:compare -- --article-id='<article-uuid>' \
  > '<controlled-test-report-path>'
```

预期本轮新发布和恢复的所有检查为 true、mismatch 为 0。若文章存在 V2 前旧 Git 历史，
允许出现已解释的 unmatched commit，但必须逐条记录，不能宣称“完全一致”。

报告含用户 UUID、路径和 Git SHA，应按测试记录管理；完成验收后按受控保留策略清理，
不要上传公共日志。

### 12.9 自动回归

```bash
TEST_DATABASE_URL='<isolated-test-url>' npm run test:v2:phase2
TEST_DATABASE_URL='<isolated-test-url>' npm run test:cms
npm run test:backup-restore
./tests/auto-deploy.integration.sh
./tests/install-auto-deploy.integration.sh
npm run test:deploy-cache-cleanup
npm run typecheck
npm run build
git diff --check
```

预期全部退出 0。构建若只有文档记录的基线静态图片 warning 且退出 0，可记录后继续；
任何新增 error、测试 skip 代替执行、或测试连接生产资源都视为失败。

## 13. 人工验收清单

- [ ] 我在测试 Git 和测试数据库发布新文章。
- [ ] 我修改并再次发布同一文章，确认 Revision 递增。
- [ ] 我恢复旧版，确认产生新 Revision。
- [ ] 我对比 Git 历史和数据库历史，确认内容一致。
- [ ] 我模拟 Push 失败，确认数据库没有错误正式版本。
- [ ] 我明确回复“V2 阶段 2 验收通过”。

## 14. 验收记录

- 维护者结论：等待。
- 人工验收日期：等待。
- 实现 Commit：由阶段 2 最终回复报告。
- 维护者确认原文：等待。
- 阶段 3 授权：维护者已明确授权实施，但阶段 2 仍等待与阶段 3 联合人工验收。

## 15. 生产构建读取运行时 `NODE_ENV` 的验收修复

2026-07-29 联合人工验收首次发布时，外部进程环境已经是 `NODE_ENV=test` 和
`CONTENT_PUBLISH_MODE=revision_shadow`，但生产构建产物仍返回：

```text
revision_shadow 只允许在 NODE_ENV=test 的隔离环境启用
```

原因是生产 bundler 会把直接读取 `process.env.NODE_ENV` 静态折叠为构建时的
`production`。因此直接运行 TypeScript 的阶段 2 自动测试通过，但
`npm run build` 后再以运行时 `NODE_ENV=test` 启动的验收路径被错误拒绝。

修复后影子开关通过反射读取真实运行时环境，生产构建产物必须保留：

```js
Reflect.get(process.env, "NODE_ENV")
```

同时，配置边界异常通过工作流错误映射返回明确的 503 信息，不再只显示通用
`Server Error`。非测试运行时仍然 fail closed，不放宽安全边界。

重新验收前必须停止旧 `.output` 进程，从包含修复 Commit 的源码重新执行：

```bash
npm ci
npm run build

rg -n 'Reflect\.get\(process\.env, "NODE_ENV"\)' \
  .output/server/chunks/nitro/nitro.mjs

NODE_ENV=test \
CONTENT_PUBLISH_MODE=revision_shadow \
DATABASE_URL='<isolated-test-url>' \
CMS_GIT_WORKTREE='<isolated-test-worktree>' \
CMS_GIT_REMOTE_URL='<isolated-test-remote>' \
node .output/server/index.mjs
```

预期 `rg` 至少命中一处；启动后的进程环境仍需单独确认两个开关。不得复用修复前构建
的 `.output`。首次失败发生在 publish record、Git 工作区创建和 Push 之前时，可继续
使用同一条 `approved` 测试草稿；先只读确认 `publish_records` 没有该草稿的尝试记录，
再单击一次发布。若已经存在 succeeded/failed/pending 记录或 Git Commit，则停止并按
12.3 的完整性检查处理，不得盲目重试。

## 16. 首次发布后再次提交被误判为“文章已有更新”的验收修复

### 16.1 现场现象与原因

2026-07-29 联合人工验收中，首次影子发布已经成功，测试 Git 远端、工作区和数据库
Revision 的 Commit SHA 一致；维护者随后从文章列表重新进入该文章并修改正文，第二次
提交审核却收到：

```text
当前文章已有更新，请重新同步后再发布。
```

只读检查确认草稿 `base_content_hash`、文章 `content_hash` 和测试 Git 工作区文件
SHA-256 完全一致，但 `articles.is_present` 已被改成 false。原因是文章列表和仪表盘
每次请求都会调用 V1 内容同步，而隔离服务的 `CMS_CONTENT_ROOT` 指向构建时静态
`content/`；首次发布的新文件只存在于独立 `CMS_GIT_WORKTREE`。旧同步因此把刚发布的
文章误判为缺失，随后并发保护正确地拒绝了第二次提交。

这不是维护者编辑或审核顺序错误。现场第二次正文仍保存在隔离数据库草稿中，不应点击
“重新同步”、删除草稿或重新创建文章。

### 16.2 修复后的读取边界

- `legacy_git` 默认模式继续按原 V1 行为从 `CMS_CONTENT_ROOT` 同步，没有生产行为切换。
- `revision_shadow` 不再在文章列表或仪表盘请求中用静态构建副本重建投影。
- 影子模式文章详情优先读取 `CMS_GIT_WORKTREE/content/...`；只有目标文件尚不存在时
  才回退到静态内容根，其他 Git 工作区错误继续 fail closed。
- 显式 `npm run cms:content:sync` 没有移除；它仍用于首次建库和受控修复。
- 前台新闻/Wiki 仍由 Nuxt Content 读取，本修复不接入真实内容仓库写权限。

回归测试故意把 `CMS_CONTENT_ROOT` 固定在首次发布前的旧 seed 内容。首次 Push 后再
调用文章列表和详情，必须确认文章仍为 present、投影哈希等于 Git 当前文件、详情正文
来自新 Git 文件。这样覆盖了现场失败顺序，而不依赖人工点击。

### 16.3 保留当前草稿的原地恢复步骤

以下命令只适用于当前阶段 2 隔离环境。先确认路径、进程 cwd、容器名和 Git 远端都带有
明确的 phase2/test 边界；任何检查失败都立即停止，不得把命令改指向生产资源。

1. 停止旧验收进程前，从 `/proc/<pid>/environ` 读入其运行时环境到当前 shell 数组；
   不打印数组内容，避免泄露隔离数据库口令或会话密钥。
2. 用 `git fetch origin main` 和 `git merge --ff-only
   <phase2-shadow-index-fix-commit-sha>` 更新临时 app，不 hard reset。
3. 在临时 app 重新执行 `npm ci` 和 `npm run build`，旧 `.output` 不可复用。
4. 只对隔离数据库执行一次显式同步，并临时把 `CMS_CONTENT_ROOT` 覆盖为
   `<phase2-root>/cms-worktree/content`。预期把受影响文章恢复为 `is_present=true`，
   不创建 Git Commit、Revision 或发布记录。
5. 使用原运行时环境重启 `.output`，检查 `/api/health`。
6. 刷新原草稿；确认第二次正文仍在，保存后重新提交审核。不要先点“重新同步”。

同步后可只读验证：

```sql
select is_present, content_hash, current_revision_id
from articles
where id = '<phase2-article-id>';
```

预期 `is_present=true`，`content_hash` 等于首次发布 Git 文件 SHA-256，
`current_revision_id` 仍指向首次发布 Revision。Revision 数量和测试远端 HEAD 在同步
前后必须不变；否则停止验收并保留日志。

### 16.4 自动验证与回滚

- 隔离 PostgreSQL 17 上 `npm run test:v2:phase2`：1 个文件、7 项测试通过。
- 同一隔离库完整 `npm test`：11 个文件、64 项测试通过。
- `npm run typecheck`：通过。
- `npm run build`：通过。
- 临时测试数据库容器已停止并自动删除。

本修复没有 Migration、依赖或新环境变量。回滚使用
`git revert <phase2-shadow-index-fix-commit-sha>` 后重跑阶段 2 专项测试、完整测试、
typecheck、build 和 `git diff --check`；不得删除现场 Revision、重写测试 Git 历史或
Force Push。回滚后若继续影子验收，旧缺陷会恢复，因此应停止验收而不是绕过并发保护。
