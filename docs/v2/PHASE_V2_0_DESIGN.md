# V2 阶段 0：现状复审、基线冻结与详细设计

> 历史基线：本文记录阶段 0 当时的盘点与设计，不是 V2.0 现行运维指令。当前入口见
> `docs/DEPLOYMENT.md` 和 `docs/v2/OPERATIONS.md`；历史记录中的固定用户不得照抄到新环境。

> 状态：设计冻结，尚未实施 V2 运行时变更。
> 最高优先级依据：`docs/v2/VINCI_CONTENT_ARCHITECTURE_V2_REQUIREMENTS.md`。
> 本文只描述已核实的 V1 现状和后续阶段目标，不把目标写成现状。

## 1. 范围、原则和非目标

阶段 0 只完成只读取证、可重复盘点、详细设计和验收准备。以下边界已经冻结：

- PostgreSQL 最终成为线上内容唯一权威来源；在阶段 5 切换前，V1 Git-first 行为保持不变。
- `SDUTVINCI/sdutvinci_content` 已由维护者创建并完成第一次复制。任何后续工具都必须先识别现有仓库，不得重新创建、清空、覆盖、批量删除或 Force Push。
- 内容仓库是数据库的异步可审计输出和提案输入，不是应用启动时的自动导入源。
- V2 最终不再依赖 `vinci-deploy`；安装、运行、Git 工作区和 systemd 默认使用执行安装的当前系统用户。
- 阶段 0 不创建业务 Migration，不写数据库，不改变发布事务、前台内容源、Nuxt Content、蓝绿部署或生产行为。
- 阶段 0 不取得内容仓库写凭据，不执行 Push、部署、生产备份、恢复或清理。

## 2. Git 与文档基线

### 2.1 代码仓库

盘点时的冻结值如下：

| 项目 | 冻结值 |
| --- | --- |
| 分支 | `main` |
| 本地 HEAD | `1752363a306d9c6bc0b44d1eb8a6ce359444637d` |
| 本地 `origin/main` | `1752363a306d9c6bc0b44d1eb8a6ce359444637d` |
| 远端 `refs/heads/main` | `1752363a306d9c6bc0b44d1eb8a6ce359444637d` |
| ahead / behind | `0 / 0` |
| 基线提交说明 | `style(cms): complete admin interface redesign` |
| 开始时工作区 | 仅有维护者提供的未跟踪 V2 需求文档 |
| 适用 `AGENT.md` / `AGENTS.md` | 仓库及已检查的父目录中均不存在 |

最近提交从新到旧为：

1. `1752363` `style(cms): complete admin interface redesign`
2. `df1a6f0`
3. `9c9b769`
4. `8289b06`
5. `0e3d3ea`

完整历史仍以 Git 为准；本表只冻结阶段 0 的可识别起点。

### 2.2 已完整阅读的输入

- `docs/v2/VINCI_CONTENT_ARCHITECTURE_V2_REQUIREMENTS.md`
- `docs/CODEX_HANDOVER.md`
- `docs/ARCHITECTURE.md`
- `docs/DEPLOYMENT.md`
- `docs/网站后台（CMS）需求文档_最终完整版.md`

V1 阶段 0～9 已在现有交接和验收记录中标为完成。V2 不回写或重解释 V1 的历史结论。

## 3. 内容基线

### 3.1 可重复盘点

执行：

```bash
npm run --silent v2:phase0:audit > /tmp/vinci-v2-phase0-audit.json
sha256sum /tmp/vinci-v2-phase0-audit.json
```

阶段 0 冻结结果：

| 集合 | Markdown 数量 | UTF-8 字节数 |
| --- | ---: | ---: |
| `members` | 32 | 14,741 |
| `news` | 2 | 4,355 |
| `wiki` | 226 | 2,555,937 |
| 合计 | 260 | 2,575,033 |

- 符号链接：0。
- 260 个文件均有 Frontmatter。
- Frontmatter 解析错误：0。
- 内容字节清单 SHA-256：`ac0fd7d32c6cd57c1ad0b8b341d3e0d72ec2eac3592d12e7b80e8ecdefc23eca`。
- 审计 JSON SHA-256：`f012582bc5bb752cc9480b7525dfc78ad7615b338838286d7d01f6edd92d15bd`。
- 最大文件：`content/wiki/2023-12-30-ros2-tutorial/1200-0200-Jazzy版本.md`，124,466 字节。

审计 JSON 包含所有相对路径，不在本文重复 260 行。

### 3.2 Frontmatter 字段基线

| 字段 | 文件数 | 集合 | 已观察类型 |
| --- | ---: | --- | --- |
| `title` | 228 | news、wiki | string |
| `id` | 32 | members | string |
| `name` | 32 | members | string |
| `type` | 32 | members | string |
| `role` | 32 | members | string |
| `affiliation` | 32 | members | string |
| `image` | 33 | members、news | string |
| `time` | 32 | members | number、string |
| `grade` | 32 | members | null、number、string |
| `advisor` | 32 | members | null、number、string |
| `links` | 32 | members | null、object |
| `date` | 3 | news、wiki | string |
| `summary` | 2 | news | string |
| `tags` | 2 | news | array\<string> |
| `author` | 2 | news | string |
| `authors` | 1 | wiki | empty array |
| `contributors` | 1 | wiki | array\<string> |
| `description` | 1 | wiki | string |
| `publishedAt` | 1 | wiki | string |
| `updatedAt` | 1 | wiki | string |
| `bvid` | 1 | wiki | string |
| Wiki 文档结构字段 | 各 1 | wiki | boolean、number、string |

“Wiki 文档结构字段”包括 `docKey`、`docRoot`、`docTitle`、`isWikiDoc`、`isWikiIndex`、`chapterDepth`、`chapterOrder` 和 `wikiDepth`。后续回填和序列化不得只保留 UI 已知字段；未知字段和值类型必须保留。

### 3.3 扩展语法基线

| 语法 | 观察结果 | 后续处理 |
| --- | --- | --- |
| `<NuxtLink>` | 6 个开始标签，分布于 4 个文件 | 建立显式兼容转换和链接属性测试 |
| MDC directive | 当前词法扫描为 0 | 保留测试夹具，不能据此删除支持 |
| `{% include ... %}` | 3 处，3 个成员文件 | 禁止静默丢弃；建立受限 include 解析 |
| 其他模板 token | 3 处，2 个 Wiki 文件 | 逐个分类；可能是代码示例，不自动执行 |
| 原始 HTML | 144 个 AST 节点，11 个文件 | 白名单、清洗、XSS 和视觉回归测试 |
| HTML 标签 | `a`、`b`、`br`、`div`、`iframe`、`img`、`p` | 对链接、图片、iframe 单独安全检查 |
| 非标准标签 | 97 次，7 个文件 | 同时含 Nuxt 组件和 XML/URDF 示例，必须按代码上下文分类 |

词法扫描是候选集，不是渲染语义结论。尤其 `<float>`、`<int>` 等可能位于代码示例；阶段 3 必须用 Markdown AST、代码围栏上下文和实际渲染共同判定。

## 4. 独立内容仓库只读基线

只读检查确认：

| 项目 | 冻结值 |
| --- | --- |
| 仓库 | `SDUTVINCI/sdutvinci_content` |
| 可见性 | public |
| 默认分支 | `main` |
| 当前提交 | `7636bca74a1591f78f7268927cbfa8ab677b24bb` |
| 提交说明 | `init` |
| 提交时间 | `2026-07-27T12:14:25Z` |
| Blob / Tree | 260 / 29 |
| 远端目录 | `content/members`、`content/news`、`content/wiki` |
| 远端 `content` Tree SHA | `be81f8c2c9114c33cdcfcb22f27e1464a64cf334` |
| 本地基线 `HEAD:content` Tree SHA | `be81f8c2c9114c33cdcfcb22f27e1464a64cf334` |

这证明首次复制在 Git 对象层面与本地基线完全一致。检查没有 clone 仓库、没有取得写凭据、没有创建分支、提交或 Push。

V2 目标文档描述内容仓库根目录为 `news/`、`wiki/`、`members/`，而真实首次复制位于 `content/` 下。这是已冻结的结构差异，不得在阶段 0 擅自更名。阶段 6 接管前必须生成逐项 move Dry Run，维护者确认后用普通提交完成；不得清空重传或改写历史。过渡期导出器以仓库清单中的 `layoutVersion` 选择路径。

## 5. V1 运行链路和 V2 差距

### 5.1 前台

当前链路：

```text
代码仓库 content/**
  → Nuxt Content 构建索引
  → queryCollection / ContentRenderer
  → 预渲染和前台页面
```

V2 差距：阶段 4 才增加数据库影子读取，阶段 5 才按集合切换权威，阶段 10 才允许移除 Nuxt Content 和代码仓库内容。阶段 0 不修改上述链路。

### 5.2 CMS、发布和历史

当前链路：

```text
Markdown 扫描 → articles 辅助索引
草稿 → PostgreSQL drafts
审核通过 → approved
正式发布 → 独立 Git 工作区原子写入 → commit → push
push 成功 → publish_records / published
历史、Diff、恢复 → Git 历史和新 Git commit
```

V2 差距：

- `articles` 没有不可变正式 Revision。
- Git push 是当前发布成功的前置条件。
- 没有与正式 Revision 同事务写入的 Outbox。
- 没有内容仓库导出、全量对账、PR 导入和三方冲突运行记录。
- 成员资料仍以 Markdown 为正式来源。

### 5.3 图片

当前链路为浏览器上传、服务端鉴权和限流、图片校验与 WebP 转换、S3 PutObject、`media_assets` 记录、返回公开 URL。图片继续以对象存储为权威，V2 只增加备份、对象存在性和 S3/COS 一致性检查，不把图片二进制写入内容仓库或数据库。

### 5.4 部署

当前为 GitHub Actions 构建 SHA 镜像，宿主机 timer 检查，app-blue/app-green 与 gateway 切换。运行镜像仍包含 `content/`；自动部署会按变更分类决定是否只重建内容镜像。V2 阶段 10 前保持现状。

### 5.5 备份

当前已有 `pg_dump` / `pg_restore` 和集成测试，但默认文档明确不自动删除旧备份。配置、内容快照、日志、报告、迁移包和临时目录尚无统一保留清单。部署镜像缓存已有有限清理和活动引用保护，但 V2 仍需统一锁、已验证回滚镜像标记和跨资产策略。

## 6. 功能开关设计

### 6.1 读取开关

为三个集合分别设置单值枚举，拒绝多个布尔值组合：

```text
CONTENT_SOURCE_NEWS=legacy_git|database_shadow|database
CONTENT_SOURCE_WIKI=legacy_git|database_shadow|database
CONTENT_SOURCE_MEMBERS=legacy_git|database_shadow|database
```

含义：

| 值 | 用户响应来源 | 数据库动作 | 失败策略 |
| --- | --- | --- | --- |
| `legacy_git` | V1 Nuxt Content | 不要求影子查询 | 保持 V1 |
| `database_shadow` | V1 Nuxt Content | 同请求或异步读取数据库并比较 | 只报告，不改变响应 |
| `database` | PostgreSQL Revision | 正式查询和 Comark 渲染 | 不静默回退 Git；健康检查失败并按运维流程回滚开关 |

启动时校验枚举。未知值直接拒绝启动；不允许用 `database_shadow` 对外返回数据库内容。三个集合可独立推进和回滚。

### 6.2 发布和导出开关

读取权威与写入事务必须分离：

```text
CONTENT_PUBLISH_MODE=legacy_git|revision_shadow|database
CONTENT_EXPORT_MODE=disabled|dry_run|enabled
CONTENT_IMPORT_MODE=disabled|dry_run|proposal
```

- `legacy_git`：现有 Git-first 发布。
- `revision_shadow`：Git 成功后追加数据库 Revision，用于阶段 2；Git 失败不产生正式 Revision。
- `database`：阶段 5 的 DB-first 事务，Revision 和 Outbox 同事务提交，GitHub 故障不阻塞线上发布。
- `CONTENT_EXPORT_MODE=enabled` 只有阶段 6 且具备专用写凭据时允许。
- 导入永远不能直接进入正式 Revision；`proposal` 只生成草稿或提案。

启动校验必须拒绝不安全组合，例如读取为 `database` 而发布仍为 `legacy_git`，或正式导出已启用但发布不是 `database`。阶段拥有者和默认值：

| 阶段 | 新环境默认 | 可测试值 |
| --- | --- | --- |
| 0～1 | 全部 `legacy_git` / `disabled` | 无运行时实现 |
| 2～3 | 读取 `legacy_git`，发布可测试 `revision_shadow` | 仅隔离环境 |
| 4 | 集合可测试 `database_shadow` | 响应仍来自 V1 |
| 5 | 经人工切换的集合可用 `database` | 导出仍可禁用 |
| 6+ | `database` + `enabled` | 逐集合启用 |

所有开关变更进入配置清单和审计日志，不在应用代码中写死。

## 7. 数据库 Schema 草案

本节是阶段 1～9 的设计输入，不是已创建的表。

### 7.1 `article_revisions`

| 列 | 类型 | 约束 / 说明 |
| --- | --- | --- |
| `id` | uuid | PK |
| `article_id` | uuid | FK `articles(id)`，`ON DELETE RESTRICT` |
| `revision_number` | bigint | 每篇文章从 1 单调递增 |
| `collection` | varchar(32) | 冻结发布时集合 |
| `relative_path` | text | 冻结发布时路径 |
| `public_path` | text | 冻结发布时公开路径 |
| `title` | text | 冻结标题 |
| `markdown_source` | text | 完整原始 Markdown |
| `body` | text | 解析后的正文，仍保留未知语法 |
| `frontmatter` | jsonb | 完整 Frontmatter |
| `content_sha256` | char(64) | 对 UTF-8 `markdown_source` 字节计算 |
| `source_kind` | varchar(32) | `backfill`、`publish`、`restore`、`member_publish` |
| `source_draft_id` | uuid nullable | FK drafts，`ON DELETE SET NULL` |
| `restored_from_revision_id` | uuid nullable | 自引用，恢复产生新 Revision |
| `publisher_user_id` | uuid nullable | 删除用户时保留 Revision |
| `reviewer_user_id` | uuid nullable | 同上 |
| `published_at` | timestamptz | 业务发布时间 |
| `created_at` | timestamptz | 插入时间 |

约束和索引：

- `UNIQUE(article_id, revision_number)`。
- `UNIQUE(article_id, content_sha256, source_kind, published_at)` 不是通用幂等键；实际幂等使用业务 operation UUID，避免相同内容的合法恢复被吞掉。
- `CHECK(revision_number >= 1)`、SHA 小写十六进制检查、集合检查。
- 索引 `(article_id, revision_number DESC)`、`published_at DESC`、`content_sha256`。
- 业务层禁止 UPDATE / DELETE；生产数据库角色可进一步撤销对应权限。

`articles` expand 变更：

- 新增可空 `current_revision_id`，在回填完成前不设 NOT NULL。
- 延后增加 FK，避免循环插入；FK 指向 `article_revisions(id)` 且 `ON DELETE RESTRICT`。
- `content_hash`、`frontmatter`、`search_text` 在过渡期保留为兼容投影。

`drafts` expand 变更：

- 新增可空 `base_revision_id`。
- `base_content_hash` 保留到切换和回滚窗口结束。
- 提交、审核、发布时同时验证 Revision ID 和内容哈希。

### 7.2 发布 Outbox

`content_export_jobs`：

| 列 | 说明 |
| --- | --- |
| `id` | 稳定 operation UUID，PK |
| `article_id` / `revision_id` | 必须指向已提交正式 Revision |
| `operation` | `upsert`、`delete`、`move`、`member_upsert` |
| `target_path` / `previous_path` | 仓库相对路径 |
| `expected_sha256` | 确定性序列化后的文件哈希 |
| `status` | `pending`、`leased`、`retry`、`succeeded`、`dead_letter` |
| `attempt_count` / `next_attempt_at` | 有界指数退避 |
| `lease_owner` / `lease_expires_at` | 崩溃后可恢复租约 |
| `last_error_code` / `last_error_summary` | 脱敏错误 |
| `export_run_id` | 最近一次运行 |
| 时间戳 | created、updated、completed |

唯一约束 `(revision_id, operation, target_path)`。DB-first 发布事务内只写 Revision、`articles.current_revision_id`、发布审计和 Outbox；不在事务内访问 GitHub。

`content_export_runs` 记录运行 ID、触发方式、基准和目标 commit、扫描/写入/跳过/冲突/失败数、开始结束时间、状态、报告路径与报告哈希。每个 job 可多次 attempt，但只能有一个成功结果。

### 7.3 全量对账、导入和冲突

`content_reconciliation_runs`：

- `mode`: `dry_run`、`repair_proposal`。
- 数据库快照边界、仓库基准 commit、manifest hash。
- missing / extra / changed / path-conflict / invalid 数量。
- 报告对象键、SHA、保留期限和状态。
- 对账不直接覆盖数据库；修复只生成 Outbox 或人工提案。

`content_import_runs`：

- PR、分支、head/base commit、提交者、Dry Run 结果、审批者、状态和摘要。
- 状态：`discovered`、`dry_run_failed`、`awaiting_confirmation`、`imported_as_proposal`、`rejected`。
- 唯一键 `(repository, pull_request_number, head_sha)`。

`content_import_items`：

- `vinci_id`、路径、operation、base/current/proposed SHA。
- 三份完整文本或受保留策略保护的对象引用。
- 分类结果、风险标签、目标 draft/proposal ID。
- 禁止直接引用“仓库当前内容”代替冻结 Proposed。

`content_import_conflicts`：

- 关联 import item。
- 类型：`base_missing`、`current_changed`、`path_collision`、`delete_modified`、`unknown_syntax`、`member_sensitive_change`。
- Base / Current / Proposed 哈希、结构化差异、解决人、解决选择和时间。
- 解决只能生成新草稿或提案，不能 UPDATE 既有 Revision。

### 7.4 成员资料

阶段 9 复用不可变 Revision 模型，`articles.collection` 的集合约束采用 expand/contract 增加 `members`，或建立 `member_revisions`。冻结选择为优先复用 `article_revisions` 和统一 Outbox，同时保留 `members` 作为查询投影及稳定成员主键。阶段 1 Migration 不提前加入成员正式切换。

## 8. 稳定 `vinciId` 与路径

- `vinciId` 等于现有 `articles.id` / `members.id` 的 UUID 字符串，不从标题、姓名、路径或 Git blob 派生。
- 首次回填先按集合和规范化相对路径匹配现有索引；不匹配、重复或大小写冲突进入报告，不自动生成第二身份。
- 导出 Frontmatter 必须包含 `vinciId`。导入缺失 `vinciId` 只能作为“新建提案”，不得据路径覆盖既有记录。
- move 保持同一 `vinciId`，Outbox 同时记录 old/new path；路径只允许仓库相对 POSIX 路径。
- 拒绝绝对路径、空段、`.`、`..`、NUL、反斜杠逃逸、符号链接目标和大小写折叠冲突。

## 9. 确定性 Markdown 序列化

同一 Revision 和同一序列化版本必须产生完全相同的字节：

1. UTF-8，无 BOM；换行统一 LF；文件末尾恰好一个换行。
2. Frontmatter 使用 `---`，不输出 YAML anchor、alias 或自定义 tag。
3. 系统字段顺序固定：`vinciId`、`title`、`description`、`authors`、`contributors`、`publishedAt`、`updatedAt`。
4. 集合已知字段按版本化清单排序；未知字段不得删除，按 Unicode code point 排序后输出。
5. 明确区分字段缺失与显式 `null`；回填时存在的 `null` 必须保留。
6. 字符串在可能被 YAML 隐式解析为日期、数字、布尔或 null 时必须加引号。
7. 数组使用 block style，object key 确定排序；禁止依赖运行时 locale。
8. 日期输出 RFC 3339 UTC；历史不规范日期原值保留在 Frontmatter，只有受管系统时间字段规范化。
9. 正文不重排标题、列表、空格、代码围栏、HTML、模板 token 或链接；只处理 Frontmatter 边界和最终换行。
10. `content_sha256` 对最终文件字节计算；导出前后重新计算并与 job 预期值比较。

序列化器带 `serializerVersion`。版本升级必须对 260 文件全量 Dry Run，输出字节 diff 数和路径，经人工确认后才能启用。

## 10. 快照 Manifest

仓库保存 `.vinci/manifest.json`，采用以下逻辑结构：

```json
{
  "formatVersion": 1,
  "layoutVersion": 1,
  "serializerVersion": 1,
  "generatedFrom": {
    "databaseSnapshotId": "uuid",
    "maximumRevisionCreatedAt": "RFC3339"
  },
  "files": [
    {
      "vinciId": "uuid",
      "collection": "wiki",
      "path": "content/wiki/example.md",
      "revisionId": "uuid",
      "revisionNumber": 1,
      "sha256": "64-lowercase-hex",
      "bytes": 123
    }
  ],
  "tombstones": []
}
```

- JSON 使用 UTF-8、LF、固定 key 顺序、2 空格缩进和末尾换行。
- `files` 按 `path` 的字节序排序，`tombstones` 按 `vinciId` 排序。
- Manifest 自身哈希记录在导出运行表和 commit trailer，不自包含。
- 快照先写临时工作树、验证完整性，再用普通 commit 推送。
- 快照不包含数据库密钥、S3 密钥、用户密码散列、Session 或未发布草稿。
- tombstone 只表达已发布删除，不授权导入端自动删除数据库内容。

## 11. 内容仓库接管与权限

### 11.1 权限模型

- `main`：只允许导出机器人账号普通 Push；开启 branch protection，禁止 Force Push 和删除分支。
- 人工本地修改：只能推送 `proposal/<actor>/<topic>` 并开 PR。
- 应用运行时：数据库读取不需要 Git 凭据。
- 导出 worker：最小权限的细粒度 Token 或 deploy key，只允许该内容仓库；密钥不进入镜像、日志或迁移包。
- PR 导入 worker：只读仓库和 PR 元数据，无 main 写权限、无数据库直连权限。
- 合并 PR 不等于发布；导入仍需 CMS 权限、Dry Run、三方比较、确认和审核。

### 11.2 阶段 6 接管步骤

1. 验证仓库身份、default branch、HEAD、branch protection 和无 Force Push。
2. 拉取只读镜像到新临时目录，拒绝非空目标目录和符号链接。
3. 对数据库正式 Revision 运行全量序列化 Dry Run。
4. 比较 `vinciId`、路径、文件哈希、额外文件和缺失文件。
5. 对当前 `content/` 与目标根目录结构生成逐项 move 计划。
6. 维护者确认布局和差异后，才启用最小写凭据。
7. 首次接管只创建普通 commit；若远端在取证后已有新提交，停止并重新对账。
8. Push 后重新读取远端 commit/tree，验证 Manifest 和文件哈希。
9. 失败时保留原 main，不回退历史；撤销凭据并重试新分支。

## 12. Comark 全量兼容计划

测试语料由两层组成：

- 冻结语料：当前 260 个 Markdown 原文和阶段 0 Manifest；测试只读，不格式化。
- 最小夹具：每种 Frontmatter 类型、NuxtLink、MDC、原始 HTML、iframe、include、模板 token、XML/URDF 代码、Unicode 路径、超长文件、相对链接、图片、代码高亮、标题 ID、目录和恶意 XSS。

每篇内容至少验证：

1. 解析不抛异常、未知语法不消失。
2. Nuxt Content 与 Comark 的标题、段落、链接、图片、代码、标题层级和目录语义对比。
3. SSR HTML 稳定且 hydration 无错误。
4. canonical、description、OpenGraph、Sitemap、RSS 和搜索文本一致。
5. 内部链接、相对资源和 404 规则一致。
6. 原始 HTML 经过明确白名单；script、事件处理器、危险 URL 和 iframe 来源测试。
7. 解析/渲染耗时和内存设置回归阈值，覆盖最大 Wiki。

差异报告必须有 path、syntax class、旧摘要、新摘要、DOM diff、风险等级、处理状态和批准人。任何未分类差异都阻止集合进入 `database`。

## 13. 各阶段升级、回滚和数据保护

| 阶段 | 升级边界 | 回滚 | 数据保护 |
| --- | --- | --- | --- |
| 0 | 文档和只读审计 | revert 阶段 0 commit | 不写 DB/内容仓库/生产 |
| 1 | expand Schema、幂等回填 | 关闭回填；保留新增表 | 回填前备份；哈希逐篇验证 |
| 2 | Git 成功后 Revision 影子写 | 发布开关回 `legacy_git` | Git 仍权威；Revision 不删除 |
| 3 | 新编辑器和渲染影子 | UI 开关回旧编辑器 | 原文和 Nuxt 渲染保留 |
| 4 | 集合级数据库影子读 | 单集合回 `legacy_git` | 响应仍来自 V1 |
| 5 | 集合级 DB-first | 单集合回已验证 Revision/旧读路径 | 切换前 DB 备份、Git/内容快照 |
| 6 | Outbox 增量导出 | 禁用 worker；不回写 DB | main 保护、幂等 job、普通 commit |
| 7 | 全量对账和恢复工具 | 只保留报告，不执行修复 | 快照 Manifest、锁定恢复点 |
| 8 | PR 导入提案 | 禁用 import | 三方原文和冲突记录保留 |
| 9 | 成员数据库权威 | members 单独回滚开关 | 成员 Revision 和导出快照 |
| 10 | contract：移除 Nuxt Content/content | 回滚到删除前 tag 和镜像 | 确认 DB、内容仓库双份完整 |
| 11 | 当前用户统一运维 | 恢复旧 unit 备份但不并行运行 | 迁移清单、属主 Dry Run、恢复演练 |

任何阶段都不做不可逆 down migration，不 Force Push，不让失败清理删除最后可恢复副本。

## 14. `vinci-deploy` 依赖盘点

可重复审计扫描 41 个受跟踪运维文件，观察到：

| 类别 | 出现次数 | 说明 |
| --- | ---: | --- |
| `vinci-deploy` | 65 | 活跃脚本、systemd、测试和历史/部署文档 |
| `/home/vinci-deploy` | 4 | 部署文档 |
| `sudo -u/-iu vinci-deploy` | 9 | 文档和备份流程 |
| `User/Group=vinci-deploy` | 3 | systemd 与文档 |
| `/opt/vinci-cms` | 73 | 安装、自动部署、备份、unit、测试和文档 |
| `/var/backups/vinci-cms` | 10 | 环境样例和部署文档 |
| 维护者具体用户名 | 31 | 主要为历史记录和示例 |
| `/home/<name>` 绝对路径 | 7 | 宿主机示例与容器内部 `/home/node` |

`/home/node` 是容器内部技术用户路径，应与宿主机安装用户分开分类，不能机械替换。`docs/CODEX_HANDOVER.md` 是历史基线，不批量重写；新文档明确替代的操作方式。

## 15. 当前安装用户迁移设计

### 15.1 身份解析

统一安装入口在宿主机解析“目标运行用户”：

1. 普通用户执行时使用 `id -un`、`id -u`、`id -g`。
2. 通过 `sudo` 执行时，只有经过 `getent passwd` 验证且非 root 的 `SUDO_USER` 可作为默认目标；否则要求显式 `--run-user`。
3. Home 必须由 `getent passwd "$user"` 解析，不拼接 `/home/$user`。
4. 保存 username、UID、主 GID、补充组、Home 和安装路径到 root 只读的安装清单。
5. 拒绝空 Home、`/`、不可解析用户、相对路径、符号链接逃逸和共享目录冲突。

用户名和 Home 只用于生成本机配置，不写死进代码仓库。

### 15.2 目录和权限

路径均可配置；默认值由安装清单决定，而不是常量：

- 应用检出目录：`--app-root`。
- CMS Git 工作区：`--worktree-root`，与运行目录物理分离。
- 状态、锁和报告：`--state-root`。
- 备份：`--backup-root`。
- 日志：优先 journald；文件日志必须位于 `--log-root` 并轮转。
- 临时目录：在 state root 下由 `mktemp -d` 创建，完成和异常均清理。

目录采用最小权限：含密钥/配置/备份的目录 `0700`，普通状态目录不高于 `0750`；文件不高于 `0600/0640`。安装器逐个校验 owner UID/GID，不递归 chown 未在清单中的路径。

### 15.3 Docker、systemd 和 Git

- Docker：检测当前用户能否访问 socket；明确 docker 组等价 root 风险。可选 rootful Docker 或经维护者批准的 rootless Docker，不自动扩权。
- systemd：模板生成 `User=`、`Group=`、`WorkingDirectory=`、`EnvironmentFile=` 和状态目录；用 systemd escaping，不接受换行和未验证值。
- timer：service 和 timer 作为一组安装、试跑、启用；迁移时先停 timer 并获取全局锁。
- Git：工作树、SSH known_hosts 和凭据属于运行用户；内容导出和代码发布使用不同最小权限凭据。
- 新服务器不同用户名时重新生成 unit 和安装清单，不复制旧 Home 绝对路径。

### 15.4 从旧用户迁移

阶段 11 的迁移顺序：

1. `./vinci doctor --legacy-user vinci-deploy --dry-run` 列出进程、unit、timer、目录、owner、ACL、Git worktree、凭据和未完成锁。
2. 创建数据库、配置和内容快照并验证；锁定恢复点。
3. 停止 timer，等待部署/备份/恢复锁释放，停止应用维护任务。
4. 为当前用户创建新目录，按清单逐项复制；哈希验证后才切换。
5. 重新生成 unit，不对旧 unit 原地字符串替换；`systemd-analyze verify` 后 daemon-reload。
6. 用当前用户试跑 doctor、backup、Git 只读、蓝绿健康检查和回滚。
7. 启用新 timer，观察至少一个周期；旧 unit 保留禁用状态到验收结束。
8. 扫描遗留 owner/进程/cron/unit/锁。只有维护者明确批准才删除旧用户，阶段 0 和自动迁移均不删除。

## 16. 备份、保留和自动清理

### 16.1 资产与默认策略

默认值以后可配置，但不能配置成“无限保留”而无告警：

| 资产 | 生成方式 | 默认保留 |
| --- | --- | --- |
| PostgreSQL 全量备份 | 每日 | 7 日 + 4 周 + 12 月 |
| 配置备份 | 配置变化和每日 | 最近 7 个 + 4 周；密钥只加密存储 |
| 内容快照 | 发布批次、每日全量 | 最近 7 日 + 4 周 + 12 月 |
| 对账报告 | 每日 03:00 | 成功 30 日，失败/冲突 90 日 |
| 健康检查报告 | 每小时/按需 | 成功 14 日，失败 30 日 |
| 迁移包 | 手工生成 | 30 日，锁定包例外 |
| 临时目录 | 每次任务 | 成功立即删；崩溃残留 24 小时 |
| journald / 文件日志 | 持续 | 时间和总量双阈值，默认 30 日 |
| Docker builder/cache | 部署后 | 7 日未引用，受磁盘阈值驱动 |
| 应用 SHA 镜像 | 每次构建 | 活动镜像 + 至少一个已验证回滚镜像 + 最近 3 个候选 |

周/月备份通过同一对象的保留标签实现，不重复复制也可。对象存储生命周期只能删除本地策略已标记可删且不受保护的对象版本。

### 16.2 永久优先保护集合

无论年龄和磁盘压力，清理器都不得删除：

- 最新成功备份。
- 最近一次完整恢复验证通过的备份。
- 显式锁定备份或迁移包。
- 当前活动 blue/green 镜像及其 digest。
- 至少一个健康检查和回滚演练验证过的非活动镜像。
- 正在上传、校验、恢复、部署、导出或迁移引用的对象。
- 数据库当前 Revision 或仍被保留 Revision 引用的 S3/COS 对象版本。

若保护集合已占满磁盘，清理器停止、告警并要求人工扩容，不突破保护规则。

### 16.3 清理算法和隔离

1. 获取与部署、备份、恢复共用的主机锁；锁超时只报告。
2. 校验 allowlist 根路径、真实路径、设备边界和 owner；拒绝 `/`、Home 根、仓库根、符号链接逃逸和未解析变量。
3. 读取带 SHA 的资产 Manifest，重新发现磁盘对象并把未知对象放入报告，不自动删除。
4. 先验证本轮新备份成功、校验成功；新备份失败时完全禁止旧备份清理。
5. 计算保护集合，再按 daily/weekly/monthly bucket 和年龄选择候选。
6. 默认 `--dry-run` 输出路径、类型、大小、原因、保护原因和预计回收空间。
7. 正式执行要求显式确认 token；逐项 rename 到同文件系统 quarantine，再删除并记录结果。
8. 单项失败不继续扩大范围；备份失败、清理失败和部署失败互相隔离。
9. 清理完成重新验证保护集合和磁盘空间，报告原子写入并轮转。

磁盘阈值默认：70% 记录预警，80% 触发安全清理，90% 触发告警并阻止非必要构建/快照；具体值可配置。阈值绝不授权删除保护对象。

### 16.4 必须实现的边界测试

- 新备份失败、校验失败、Manifest 缺失时不删旧备份。
- 最新成功、最近验证、锁定和跨 GFS bucket 的同一备份都受保护。
- 只有一个可恢复备份时保留。
- active slot、活动镜像 digest 和唯一已验证回滚镜像保留。
- 正在部署/恢复时清理获取不到锁且无副作用。
- 路径为 `/`、Home、相对路径、符号链接、空变量、跨设备时拒绝。
- 未知文件只报告；Dry Run 与正式候选集合一致。
- 磁盘 90% 且全为保护对象时失败告警，不强删。
- S3/COS versioning、delete marker、生命周期与本地 Manifest 一致。
- 日志、报告、迁移包、临时目录、旧镜像和 builder cache 都有上限。

## 17. 详细运维教程目录和维护规则

阶段 6、7、10、11 按实现同步编写：

1. `FIRST_INSTALL.md`：全新服务器和空库/快照选择。
2. `CURRENT_USER_AND_PERMISSIONS.md`：用户、UID/GID、Home、Docker、systemd、属主。
3. `GITHUB_AND_REGISTRY.md`：Actions、镜像仓库、内容仓库、Deploy Key/Token。
4. `POSTGRES_BACKUP_RESTORE.md`：自动/手工备份、校验、空库恢复。
5. `SERVER_MIGRATION.md`：旧服务器导出、新服务器导入和不同用户名。
6. `OBJECT_STORAGE_S3_COS.md`：S3/COS、版本控制、生命周期和一致性检查。
7. `CONTENT_REPOSITORY.md`：现有仓库、接管、Outbox、对账、PR 导入和重试。
8. `BLUE_GREEN_AND_CLEANUP.md`：部署、回滚、日志、镜像和缓存清理。
9. `DISASTER_RECOVERY.md`：数据库、内容仓库和对象存储的组合恢复。
10. `FAQ.md`：常见失败、诊断和升级路径。

每篇必须具备统一章节：适用场景、前置条件、执行用户和权限、配置、可复制命令、逐步预期结果、验证、失败原因与处理、回滚、安全注意事项。示例只用占位值，不含真实账号、地址、密码、Token 或私钥。命令随真实实现更新，计划命令必须标注“尚未实现”。

## 18. 灾难恢复设计

恢复点必须绑定四类标识：

- PostgreSQL backup ID、SHA、Migration 版本和 restore-verified 时间。
- 内容仓库 commit、Manifest SHA 和布局/序列化版本。
- S3/COS bucket、versioning 状态和对象清单哈希。
- 应用 commit、镜像 digest、活动槽位和已验证回滚 digest。

恢复顺序：

1. 隔离新环境，验证备份和清单，不连接生产写端点。
2. 恢复空 PostgreSQL，执行兼容 Migration 并做行数/Revision/hash 检查。
3. 配置只读对象存储，检查所有已发布图片对象和版本存在。
4. 从锁定 digest 启动应用，保持内容导出和导入禁用。
5. 对数据库生成内容快照并与内容仓库对账；内容仓库不得覆盖数据库。
6. 运行 API、页面、权限、发布 Dry Run、蓝绿和回滚检查。
7. 维护者批准后再切换流量、启用 timer 和导出 worker。

RPO/RTO 由维护者在阶段 7 验收前填写。没有明确目标时，文档不得宣称已满足某个恢复时限。

## 19. 安全边界

- 所有外部 Markdown 都是不可信输入；未知 HTML/模板不得执行。
- 数据库、GitHub、S3/COS 错误只记录脱敏错误码和摘要。
- 内容仓库机器人无代码仓库、数据库或对象删除权限。
- 恢复默认拒绝非空数据库；覆盖只允许人工、隔离、显式双重确认。
- 测试只使用隔离数据库、临时目录、替身对象存储和只读公开 Git 元数据。
- Migration 采用 expand/contract，蓝绿旧版本必须能在 expand 窗口继续运行。
- 所有删除和 move 均进入审计并需要独立确认。

## 20. 阶段 0 结论与进入阶段 1 的门槛

阶段 0 的实现内容仅为审计脚本和文档。只有维护者完成 `PHASE_V2_0_ACCEPTANCE.md` 的人工步骤、明确回复“V2 阶段 0 验收通过”后，才允许开始阶段 1。阶段 1 仍需独立设计评审 Migration、隔离数据库回填和回滚，不得把本文 Schema 草案直接应用到生产。
