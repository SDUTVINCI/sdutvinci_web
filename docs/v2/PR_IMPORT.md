# V2 阶段 8：Markdown PR 导入、权限与三方冲突

## 1. 权威关系与边界

PostgreSQL 的正式 Article/Revision 仍是唯一正式内容权威。内容仓库 `main` 是阶段 6
导出的只读快照；PR 是提案载体，不是发布入口。阶段 8 只把选中的安全项目转换为普通
数据库草稿或移动/删除提案，不会批准、发布、创建正式 Revision、Merge PR 或覆盖非空
数据库。

普通 PR 导入使用 `content_pr_import_*` 表和 `/api/cms/content-imports/**`，与阶段 7
`content_import_*` initialize/disaster recovery CLI、确认令牌和 operations profile 完全
分离。阶段 8 入口不能调用全量恢复，也不读取本地 clone/worktree 作为最终状态。

V2 阶段 10 后，代码仓库已移除三类正式内容目录和 Nuxt Content。这里提到的 Base、Head、
snapshot 和 Markdown 全部来自独立内容仓库/GitHub PR API；代码仓库、production build 和
runtime 镜像不提供内容回退源。这个变化不改变导入权限、三方合并、Proposal、Revision、
Outbox、评论/关闭确认或“绝不自动 Merge”的边界。

## 2. 权限和 GitHub API

- `admin` 和 `member` 均可访问外部内容导入；不再使用独立的 `content_importer` 角色。导入只生成草稿或成员 Proposal，最终审核、发布和上线仍由管理员执行。
- 每个 API 都在服务端复核登录态和角色；写请求还必须通过同源与 CSRF 校验。
- 只接受 `SDUTVINCI/sdutvinci_content` 或与 PR 编号一致的官方 GitHub PR URL。
- PR 必须 open、Base repository 必须匹配、Base branch 必须为 `main`，Base/Head 必须是
  完整 40 位 Commit，Head repository 不能缺失。
- 默认只允许 `https://api.github.com`。本地 mock 仅在运行时 `NODE_ENV=test` 且
  `CONTENT_PR_IMPORT_TEST_MODE=true` 时允许。
- Dry Run 只调用 PR、分页 files 和 commit-bound contents API。评论和关闭 PR 是两个
  独立 POST 入口，各自要求确认字符串；关闭还要求 `admin`。没有 Merge API。
- `CONTENT_PR_IMPORT_GITHUB_TOKEN` 未配置时，Dry Run 仍可使用公开读取，但评论和关闭
  fail closed。Token、Authorization、远端 URL、私钥和绝对路径不进入响应或审计摘要。
- PR 文件数超过 `CONTENT_PR_IMPORT_MAX_FILES` 时，页面明确显示“PR 文件数量超过服务器允许的
  导入上限”并保留 `GITHUB_PULL_FILE_LIMIT_EXCEEDED` 错误码；这属于本地安全上限，不应误报为
  GitHub API、Token 或网络故障。
- 默认上限为 GitHub PR files API 可配置范围内的 `500`，足以处理结构化 Wiki 批量导入；超过
  500 个文件的提案仍应拆分 PR，不通过移除上限规避资源保护。
- 文件规划使用固定最大并发 `10` 读取 commit-bound Base/Head 内容并执行分类；结果仍按 GitHub
  Diff 原 ordinal 排列，全部规划完成后才在单个事务中写 run/items。并发数不可随 PR 规模无限
  增长，避免把同步 Dry Run 串行放大为代理 524，也避免瞬时打满 GitHub API 和数据库连接池。
- `/import` 的 `itemIds` 数量上限与 `CONTENT_PR_IMPORT_MAX_FILES` 使用同一配置（默认 `500`），
  不再保留独立的 200 项硬编码限制；服务仍逐项事务导入并保持幂等，不在浏览器静默拆批。

## 3. Base、Current、Proposed

每次 Dry Run 固定三个输入：

1. **Base**：PR Base Commit 中 `.vinci/snapshot.json` 指向的原始 Markdown；逐文件核对
   snapshot 的路径、`articleId`/`vinciId`、Revision、字节数和 SHA-256。
2. **Current**：数据库文章当前正式 Revision，用阶段 6 确定性 serializer 重新生成。
3. **Proposed**：PR Head Commit 中 Diff 声明的新文件内容；删除时为 `null`。

服务只读取 PR API 返回的 Diff 文件，并按 Base/Head Commit 读取内容。未在 Diff 中的
文件、PR 外本地目录、代码仓库现有 `content/` 都不会参与“最终状态”计算。

`content_pr_import_items` 保存 Base/Current/Proposed/Merged 原文、四个哈希、Base/
Current Revision、分类、警告、冲突详情、导入状态和生成的 draft ID。授权 CMS 用户可
查看经过敏感值替换的四方材料。

## 4. 三方合并算法

先对换行规范化，再以 Base 为共同祖先计算 Current 和 Proposed 的行级 edit。每个 edit
扩展到其 Markdown 段落边界：

- Base 等于 Current：Proposed 是安全修改；
- Base 等于 Proposed：保留 Current；
- Current 与 Proposed 对同一段做完全相同的修改：去重后保留一次；
- 两侧只修改不同段落：按 Base 坐标从后向前应用，生成自动合并结果；
- 两侧修改同一段且结果不同：记录冲突行范围，Merged 为 `null`，阻止导入。

Dry Run 后导入每一项时，会在同一事务中锁定导入项和文章，并重新验证
`currentRevisionId`。数据库若在 Dry Run 后又发布新 Revision，该项转为
`content_conflict`/`blocked`，不会创建草稿。发布阶段还会再次用 draft
`baseRevisionId` 检查正式 Current，因此没有静默覆盖窗口。

## 5. 分类和动作

| 分类 | 可直接选择 | 阶段 8 动作 |
| --- | --- | --- |
| `safe_change` | 是 | 创建普通编辑草稿 |
| `auto_merge` | 是 | 保存四方材料，使用 merged 内容创建草稿 |
| `content_conflict` | 否 | 保留冲突证据，等待人工另行处理 |
| `new_article` | 是 | DB 在 Dry Run item 上预分配 UUID；只创建新文章草稿 |
| `move_or_rename` | 是 | 保持 vinciId，创建同目录移动提案并记录引用/重定向检查 |
| `deletion_proposal` | 是 | 只创建删除提案 |
| `path_conflict` | 否 | 显示重复路径/ID、路径占用、越界或非法移动 |
| `invalid_file` | 否 | 显示不受管文件、内容/快照/Frontmatter 错误 |
| `unknown_syntax` | 否 | 突出未知模板或扩展指令 |
| `high_risk_syntax` | 默认否；可人工强制 | 突出原始 HTML、Vue/MDC、脚本/事件/危险 URL；逐项勾选并准确输入“确认强制导入高风险内容”后只创建待审核草稿 |

新文章发布前一直没有正式 Article 行；发布时才使用预分配 UUID 和已审计目标路径创建
Article/Revision。移动发布保持同一 Article ID，写 `article_redirects`，旧公共路径仍能
解析到同一文章。删除提案只有在正常提交、另一位审核者批准和管理员明确发布后才标记
Article 删除并创建 export outbox；导入本身不会删除任何正式内容。

文章 `authors`/`contributors` 中能匹配成员稳定 ID 的值继续进入成员关联；暂时没有成员档案
的原始人名也会保存在草稿内部，并在正式发布时恢复到同名标准 Frontmatter 字段。内部保存键
不会出现在公开 Markdown 中，导入不再因单个署名无法匹配而阻止整篇文章。

## 6. 文件安全

文章受管路径只能是 NFC 编码的 `news/**/*.md` 或 `wiki/**/*.md`；阶段 9 另允许已在 Base
snapshot 登记的 `members/**/*.md` 做原路径修改或删除提案。拒绝绝对路径、反斜线、
NUL、`.`/`..`/`.git` 段、跨 collection 或跨目录移动、成员新增/重命名、README、
manifest 外文件、重复路径/vinciId、非法 UTF-8、二进制、符号链接、非 file API 类型、
超限文件和超限 PR。新文章不得自带 vinciId；正式 ID 只能由数据库分配。

新增文章会扫描全文；修改/重命名文章只比较 Base → Proposed 新增的语法特征。只有 PR 新增
HTML/Vue 标签、MDC 指令、可执行标签、事件属性、`javascript:`/`data:` 或未知模板语法才
产生相应风险警告；Base 已有且本次没有新增的同类结构不会因普通正文变化误报。代码围栏和
行内代码先被剔除，避免仅作为示例的片段被误当作可执行内容。

## 7. 幂等、审计和失败取证

`(repository_id, pull_request_number, head_commit_hash)` 唯一；同一 PR/Head 的并发或重试
返回同一 run。item 在事务中锁定，已导入项直接返回原 draft，不重复创建。允许选择
任意安全子集，冲突项保持 pending/blocked，不回滚已成功的其他项。

审计覆盖 Dry Run、逐项导入、选择批次、评论、关闭和外部写失败。GitHub 外部动作另存
processing/succeeded/failed 与脱敏错误码。排障时先保留：

1. CMS run ID、PR 编号、Base/Head、分类和 item ID；
2. `content_pr_import_runs/items/external_actions` 与对应 `audit_logs`；
3. 应用和 mock/API 日志中的错误码；
4. 本地测试裸仓库 Base/Head object 和 fixture，不要保存 Token。

不要把完整环境变量、Authorization header、数据库 URL、私钥、绝对 workspace 路径或
带凭据远端 URL 粘贴到工单。

## 8. 回滚

应用回滚使用普通向前 `git revert <阶段8实现Commit>`，不 reset/rebase/force-push。
Migration `0016_flowery_war_machine.sql` 是 expand-only：只增加 PR run/item/action、redirect
表、兼容草稿提案列和角色。旧应用会忽略这些对象，所以不执行破坏性 down migration。

回滚应用后可保留导入 run、草稿和审计供取证；未发布草稿可走现有软删除/撤回流程。
已经通过正常审核发布的 Revision 仍按现有 Revision restore/delete restore 流程处理，
不能通过删除 PR run 回滚正式内容。评论/关闭属于 GitHub 外部状态，不随数据库事务
回滚；关闭 PR 后如需恢复，只能由管理员在 GitHub/mock 独立重新打开，仍不得自动 Merge。

高风险人工强制放行只适用于 `high_risk_syntax` 文章，不能覆盖未知扩展语法、内容冲突、非法
路径、非法文件或成员敏感字段。服务端会复核所选 ID、分类、确认短语和实时 Current Revision，
三方合并失败时仍阻止；成功时写 `content_pr_import.high_risk_forced` 审计。该动作不批准、不
发布、不创建正式 Revision，也不改变 Markdown 渲染器现有的脚本和危险 URL 阻断策略。

## 9. 测试与本地人工验收

- 专项：`npm run test:v2:phase8`（必须设置名称含 `test` 的独立 `TEST_DATABASE_URL`）。
- 完整 CMS：`npm run test:cms`，使用同样隔离规则。
- 浏览器夹具：`npm run v2:phase8:manual -- start|status|inspect|stop`。

人工夹具使用 `vinci-v2-phase8-manual-test-*` 三个带标签容器、回环端口 55452/34162/
34163、`/tmp/vinci-v2-phase8-manual-test` 归属标记、本地裸 Git 远端和 mock GitHub API。
它不会访问真实 GitHub、生产数据库、生产仓库权限或部署环境。完整步骤见
`PHASE_V2_8_ACCEPTANCE.md`。

## 10. 阶段 9 成员提案扩展

成员 snapshot 条目绑定 `memberId`、稳定 `memberKey`、Base `revisionId`、源路径、字节数与
SHA-256。允许修改的 Markdown 字段仅为姓名、头像、展示角色/类型、参与与指导届次、年级、
单位、公开链接、简介正文、公开 metadata 和排序号。账号绑定、登录账号/密码、系统角色与
权限、安全状态等不在 profile 中，递归出现敏感键时整项分类为
`member_sensitive_rejected`，且 Proposed 原文不进入可查看 artifact。

`member_safe_change` 与 `member_auto_merge` 可被选择导入为 `member_proposals`；
`member_conflict`、`member_sensitive_rejected` 和 `member_invalid` 保持阻止状态；
`member_deletion_proposal` 只建立删除提案。导入事务复核 Current Revision，但绝不更新成员
pointer。管理员必须在成员页再次明确接受，服务再次用 `members.version` 和 Revision pointer
加锁校验，随后才创建不可变 Revision、审计和 export Outbox。PR 评论/关闭边界保持阶段 8
不变，没有 Merge API。

## 11. CMS 中如何理解外部操作和四方差异

“把检查结果留言到 PR”只会在 GitHub PR 下发送一条脱敏摘要，告诉提案人检查、导入和
阻止数量。它不会发送文章或成员正文，也不会合并 PR、批准草稿、接受成员提案或发布
内容。

“关闭这个 PR（仅管理员）”只会把 GitHub PR 标记为已关闭，表示不再继续处理这个提案。
它不会合并或发布，也不会删除已经创建的草稿、成员提案、导入记录或审计记录。评论和
关闭继续使用两个独立确认入口；CMS 用带图标、边框和背景的中文状态卡片显示执行中、
成功或失败，不再直接显示 `comment · succeeded` 一类内部值。

四方材料按 Git diff 习惯显示旧/新行号、`+`/`-` 和整行底色：

- Base 是开始本地修改时的原文，也是比较基准；
- Current 与 Base 比较，显示数据库在 PR 创建后发生的变化；
- Proposed 与 Base 比较，显示 PR 自己提出的变化；
- Merge 与 Current 比较，显示真正导入草稿后相对当前正式内容会发生的变化。

绿色 `+` 行表示新增，红色 `-` 行表示删除或被替换，无底色行是上下文。新增、删除、
冲突和敏感成员资料没有某一份材料时，页面显示对应原因，不把“没有安全合并结果”误写成
空正文。文章段落合并和成员字段级合并共用该显示规则，但服务端合并、权限和脱敏逻辑
没有变化。

## 12. 阶段 10 回归保护

外部内容导入页面继续从稳定根别名导入
`shared/utils/content-import-diff.ts`；该 helper 是普通共享模块，不属于 Nuxt Content。
production build 与 Nitro 必须能解析它。自动测试固定覆盖：白话安全说明、中文动作/状态、
评论和关闭的独立授权说明、四方白话标题、文件卡片内联展开、`aria-expanded`/
`aria-controls`、真实新增/删除/替换的旧新行号和上下文，以及删除、冲突、新文章和敏感成员
材料的空状态。阶段 10 不允许通过删除旧断言规避这些行为。

## 13. 阶段 11 运维诊断

`./vinci doctor` 只读汇总 pending/failed 内容导出任务、最近凌晨对账和待处理 PR 导入，不
读取 PR 外目录、不执行评论/关闭/Merge，也不改变 run/item/draft/proposal。错误继续遮盖敏感
信息；排障只使用 run/item ID、分类、计数和固定错误码。

## 14. 分类筛选、高风险入口和后续批量工作流

Dry Run 报告中的分类统计同时是筛选按钮，可在“全部分类”“安全修改”“高风险 HTML / Vue /
MDC”等实际出现的分类之间切换。筛选只改变当前页面显示，不改变选择结果、服务端分类或导入
权限。

可人工覆盖的高风险文章会显示明确的“强制导入此高风险项（仍需输入确认短语）”选择说明。
勾选后仍须在上方输入精确确认短语；包含未知语法、三方冲突、非法文件或路径问题的项目不会
显示该入口，也不能被筛选或浏览器参数绕过。

导入草稿之后可在草稿列表批量提交审核，在审核页批量审核通过，并在“已通过，等待发布”区域
批量正式发布。每批最多 500 篇，服务端以最多 10 项并发复用单篇操作的身份、CSRF、所有权、
编辑锁、版本、状态和正式 Revision 基线校验；不会同时启动 500 个事务。部分项目失败不会把
其余成功项目回滚；接口和页面返回逐项结果
及成功/失败计数，失败项目保持原状态。批量发布沿用单篇发布的既有路径、导入提案路径或安全
默认路径规则；需要人工指定特殊路径的新文章应进入详情页单独发布。

风险分类之外，报告还提供独立的处理状态统计和筛选：“等待处理”“已导入草稿 / 提案”
“已阻止”“已跳过”。两个维度可以组合使用，页面同时显示当前结果数和总数；筛选只影响可见
列表，不改变已经勾选的项目、数据库状态或权限。执行导入时若因同一账号已有该文章的未删除
草稿而阻止重复创建，项目会记录 `IMPORT_ACTIVE_DRAFT_EXISTS` 并显示中文原因。历史上未记录
具体错误码的 blocked 项显示明确的旧记录说明，不再把“安全修改”分类误解成已经成功导入。

外部内容导入页提供“全选当前可导入结果”：只选择当前风险分类与处理状态筛选结果中仍为
pending，且服务端允许普通导入或高风险人工确认的项目；已阻止、已导入、已跳过及不可覆盖的
冲突项不会被选中。取消全选也只移除当前结果，保留其他筛选条件下已经手动勾选的项目。草稿页
对应“全选可提交草稿”，审核页分别对应“全选待审核”和“全选待发布”。
