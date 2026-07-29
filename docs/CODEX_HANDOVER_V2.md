# Vinci Content Architecture V2 交接记录

> 本文件从创建起只允许在末尾追加新的阶段记录。不得回写、重排或删除既有记录；
> 更正也必须以新的追加段落说明。V1 历史基线继续保留在 `docs/CODEX_HANDOVER.md`。

## 2026-07-27：V2 阶段 0——现状复审、基线冻结与详细设计

### 完成状态

- 实现：阶段 0 的只读审计、基线冻结和详细设计完成。
- 自动化验证：通过。
- 人工验收：等待维护者验收，所有人工验收项均未勾选。
- 下一阶段是否开始：否；未进入阶段 1。

### 修改内容

- 完整阅读 V2/V1 需求、V1 交接、架构和部署文档；未发现适用的仓库 `AGENT.md` / `AGENTS.md`。
- 冻结代码仓库基线：父提交 `1752363a306d9c6bc0b44d1eb8a6ce359444637d`，开始时本地、远端 main 一致，ahead/behind 为 0/0。
- 新增确定性只读审计，盘点 32 members、2 news、226 wiki，共 260 个 Markdown。
- 完整统计 Frontmatter 类型和 NuxtLink、MDC、HTML、include、模板 token、非标准标签候选集。
- 只读核验已存在 `SDUTVINCI/sdutvinci_content`：commit `7636bca74a1591f78f7268927cbfa8ab677b24bb`，远端 `content` tree 与本地父提交 `content` tree 同为 `be81f8c2c9114c33cdcfcb22f27e1464a64cf334`。
- 复审 V1 前台、CMS、发布、历史、图片、部署和备份链路。
- 输出集合级功能开关、Revision / Outbox / 导出 / 对账 / 导入 / 冲突 Schema 草案。
- 输出 `vinciId`、路径安全、确定性 Markdown 序列化、Manifest 和 Comark 全量语料方案。
- 输出阶段 0～11 升级、回滚和数据保护表。
- 盘点 `vinci-deploy`、固定 `/opt/vinci-cms`、固定备份根和 Home 依赖，并设计迁移到当前安装用户。
- 输出全资产保留、自动清理、Dry Run、磁盘阈值、失败隔离和灾难恢复设计。
- 输出十类详细运维教程的目录和强制维护结构。
- 只在现有架构文档末尾记录已确认但尚未实现的 V2 约束。

### 修改文件

- `docs/VINCI_CONTENT_ARCHITECTURE_V2_REQUIREMENTS.md`
- `docs/CODEX_HANDOVER_V2.md`
- `docs/ARCHITECTURE.md`
- `docs/v2/PHASE_V2_0_DESIGN.md`
- `docs/v2/PHASE_V2_0_ACCEPTANCE.md`
- `scripts/v2-phase0-audit.mjs`
- `package.json`

没有修改 `content/**/*.md`、Migration、应用运行时、API、Docker、Compose、systemd、GitHub Actions、部署或备份脚本。

### 数据库变更

无。仍为 `0000`～`0010` 共 11 个 SQL Migration 和 11 个 snapshot。Schema 内容仅为后续阶段草案。

### API 变更

无。

### 新增依赖

无。审计脚本复用已锁定的 `remark` 和 `yaml`，`package-lock.json` 无变化。

### 新增环境变量

无。文档中的功能开关名称是后续阶段设计，不是当前已支持配置。

### 架构决定

- 最终 PostgreSQL Revision 权威；阶段 5 前保持 Git-first。
- 三个集合独立支持 `legacy_git`、`database_shadow` 和 `database`。
- DB-first 发布事务内写 Revision 和 Outbox，事务外异步导出 Git。
- 内容仓库 main 只能由机器人普通 Push；PR 只产生提案，不能自动发布或覆盖数据库。
- 真实内容仓库当前仍有 `content/` 前缀；阶段 6 接管前必须对目录 move 做 Dry Run 和人工确认。
- V2 最终以当前安装用户运行；身份和 Home 从系统解析，重新生成 unit，不机械替换。
- 所有可增长资产有有限保留；五类保护对象不受磁盘压力删除。

### 测试与构建

- `npm run --silent v2:phase0:audit` 连续两次一致；JSON SHA-256 `f012582bc5bb752cc9480b7525dfc78ad7615b338838286d7d01f6edd92d15bd`。
- `npm run test:cms`：8 文件、41 项通过。
- `./tests/auto-deploy.integration.sh`：通过。
- `./tests/install-auto-deploy.integration.sh`：通过。
- `./tests/deploy-cache-cleanup.integration.sh`：通过。
- `npm run test:backup-restore`：通过。
- `npm run wiki:check`：226 文件通过。
- `npm run typecheck`：通过。
- `npm run build`：通过。
- 运维 shell 语法、Compose config、systemd unit 语法和阶段 0 runtime/Migration 边界检查：通过。
- `git diff --check`：通过。

CMS 首次调用因隔离数据库名不含 `test` 被安全护栏拒绝，改用 `vinci_v2_phase0_test` 后完整通过。首次 systemd 检查误用了不存在的 unit 名，改用仓库真实文件后通过语法检查，并因本机不存在生产 `/opt/vinci-cms` 而输出预期的 ExecStart 文件提示。

### 安全和生产资源边界

- 没有取得或使用生产密钥。
- 只读访问真实公开内容仓库元数据和 Git tree；没有 clone、创建、修改、删除、commit、merge、push 或 force push。
- CMS 测试使用临时隔离 PostgreSQL 容器，结束后已删除；没有触碰原有 `vinci-cms-postgres`。
- 备份恢复测试使用 `/tmp`、隔离 Compose project、测试数据库和无效 S3/Git 地址，退出时清理容器和卷。
- 没有接触生产数据库、S3/COS、服务器、容器或部署入口。
- 没有 Push、部署或生产清理。

### 已知问题

- 语法盘点是候选集，不等于 Comark 已兼容；完整验证属于阶段 3。
- 内容仓库 branch protection、机器人写权限和导出流程尚未测试，属于阶段 6。
- 真实仓库 `content/` 布局与 V2 目标根布局存在差异，尚未更名。
- `vinci-deploy` 扫描含历史文档、测试和容器内部 `/home/node`，后续迁移不能机械替换。
- 当前自动备份没有 V2 保留清理实现；阶段 0 只有设计，不能宣称已解决增长问题。
- RPO/RTO 等灾备业务目标等待维护者确定。
- production build 保留基线已有的部分静态图片运行时解析 warning，构建退出 0；阶段 0 未改这些资源。

### 回滚方法

使用普通 `git revert <阶段0-commit-sha>` 撤销本阶段独立提交，再运行 `npm run typecheck`、`npm run build` 和 `git diff --check`。如果需要保留维护者提供的 V2 需求文档，则在新的普通提交中恢复该文件。不得 hard reset、Force Push 或回退/覆盖独立内容仓库。

本阶段没有数据库或生产写入，因此不需要数据恢复、镜像回切或内容仓库回滚。

### 人工验收步骤

1. 用 `git show --stat <阶段0-commit-sha>` 和限定路径 diff 核对提交范围。
2. 确认父提交和父提交 `content` tree 分别是 `1752363...` 和 `be81f8...`。
3. 只读检查内容仓库存在、main commit 和三个 `content/*` 目录；不要进行任何写操作。
4. 重跑审计，确认 32 / 2 / 226、0 symlink、0 Frontmatter 错误。
5. 审查功能开关、Schema、内容仓库权限、序列化和各阶段回滚。
6. 审查当前用户识别、unit 重建、目录属主和旧用户迁移流程。
7. 审查保留表、保护集合、清理边界测试、灾备顺序和教程目录。
8. 在无生产凭据的隔离环境重跑阶段 0 自动验证。
9. 全部接受后明确回复“V2 阶段 0 验收通过”。

详细命令、预期结果、失败处理和安全注意事项见 `docs/v2/PHASE_V2_0_ACCEPTANCE.md`。

### 下一阶段注意事项

- 未收到明确人工验收原文前不得开始阶段 1。
- 阶段 1 不得写真实内容仓库，也不得切换前台或发布事务。
- Migration 采用 expand，先在隔离数据库 Dry Run；回填必须幂等并逐篇核对 SHA。
- 基线后的代码内容或远端内容仓库提交必须重新盘点，绝不能用本记录覆盖新内容。

### Commit

本记录将与阶段 0 的独立 commit 一同提交。最终不可循环自引用的 Commit SHA 由本阶段最终回复报告；在提交完成前不预填或猜测 SHA。

## 2026-07-27：V2 阶段 0——维护者人工验收收尾

### 完成状态

- 实现：阶段 0 实现 Commit `6a46251db9226aa5065dce35ab3a3b3c4a1ec85f` 保持不变。
- 自动化验证：阶段 0 已通过。
- 人工验收：通过。
- 下一阶段是否开始：维护者已明确要求收尾后执行阶段 1。

### 维护者确认

- 确认时间：2026-07-27。
- 确认原文：`阶段0验收结束，收尾后执行阶段1`
- 解释：维护者结束阶段 0 验收并在同一句中授权进入阶段 1，因此按阶段 0 验收通过记录。

### 路径更正

维护者在 Commit `940dc7e7371fb8ca9320477785528addaee9b3c9` 中把 V2 权威需求从
`docs/VINCI_CONTENT_ARCHITECTURE_V2_REQUIREMENTS.md` 移动为
`docs/v2/VINCI_CONTENT_ARCHITECTURE_V2_REQUIREMENTS.md`。文件内容未在该 Commit 中改变；
后续阶段使用新路径。前一条交接记录中的旧路径是当时真实路径，按追加式规则不回写。

### 验收记录变更

- 勾选 V2 阶段 0 总体进度。
- 勾选阶段 0 全部人工验收项。
- 补齐阶段 0 的 Commit SHA 报告与停止等待记录。
- 更新阶段 0 验收结论、确认原文和进入下一阶段授权。

### 安全和生产资源边界

本次收尾只修改文档复选框、验收记录和路径引用，不修改数据库、API、内容、部署或生产资源。

## 2026-07-27：V2 阶段 1——正式 Revision 数据模型与安全回填

### 完成状态

- 实现：阶段 1 实现完成。
- 自动化验证：全部通过。
- 人工验收：等待维护者验收，阶段总体完成和人工验收项未勾选。
- 下一阶段是否开始：否；未进入阶段 2。

### 基线

- 阶段 1 开始时 HEAD 为维护者 Commit
  `940dc7e7371fb8ca9320477785528addaee9b3c9`，其唯一变化是把 V2 权威需求移动到
  `docs/v2/`。
- 阶段 0 人工验收收尾 Commit 为
  `d20c0b9`；阶段 1 在该独立文档 Commit 后实施。
- 没有发现适用的仓库 `AGENT.md` 或 `AGENTS.md`。
- 没有覆盖、丢弃、暂存或回退来源不明的改动；阶段 1 开始实施前工作区干净。

### 实现内容

- 新增 expand-only `article_revisions`，保存完整 Markdown 原文、正文、
  Frontmatter、SHA-256、文章内版本号、来源类型和发布/审核/恢复关联预留字段。
- 新增可空 `articles.current_revision_id` 和 `drafts.base_revision_id`，继续保留
  全部 V1 兼容字段。
- 增加文章内版本唯一约束、版本号/哈希/来源检查约束及查询索引；外键采用
  `restrict` 或关联主体删除后的 `set null`。
- 新增默认只读回填 CLI。实际写入要求
  `--apply --confirm=BACKFILL_ARTICLE_REVISIONS`，不会隐式运行 Migration。
- 以 `(collection, relative_path)` 映射现有 `articles.id`，该 UUID 同时作为未来
  `vinciId`；不批量改写 Markdown。
- apply 使用 advisory transaction lock、稳定文章行锁、事务内文件二次读取和
  单一事务；任一 blocker 或写入失败时不留下半回填。
- 已删除和 `is_present != true` 的文章明确跳过；活跃文章缺文件、哈希漂移、
  未索引文件、指针损坏和既有 Revision 冲突均 fail closed。
- 重复运行识别首版或当前 Revision，不生成重复版本，也不改变 V1
  `articles.updated_at`。
- CMS 测试清理显式包含新表，备份恢复演练覆盖 Revision 原文/哈希及两个指针。

### 数据库、API、依赖和环境变量

- 新增 Migration `0011_thankful_proteus.sql`、Drizzle snapshot 和 journal 记录。
- Migration 只建表、加可空列/约束/索引；不回填、不删除、不重命名旧列。
- API 变化：无。
- 依赖和锁文件变化：无。
- 新增环境变量：无；CLI 复用 `DATABASE_URL` 和 `CMS_CONTENT_ROOT`。

### 架构边界

- 当前生产内容、发布、历史、恢复和前台仍是 V1 Git-first / Nuxt Content；
  Revision 尚未成为发布或读取权威。
- 阶段 1 只处理 news/wiki；members 属于阶段 9。
- 没有修改正式发布事务、Git 历史/恢复入口、前台内容来源、API、Docker、
  Compose、systemd、自动部署行为或 `content/**/*.md`。
- 没有访问独立内容仓库写端点，也没有新增真实写权限或凭据。

### 自动化验证

- 阶段 1 专用集成测试：1 个文件、9 项通过，覆盖空库、模拟 V1、只读 Dry Run、
  业务层不可变、完整原文、228 篇哈希、幂等、冲突/缺失和事务回滚。
- 完整 CMS：9 个文件、50 项通过。
- CLI：228 个 Dry Run 待创建；首次 apply 创建/链接各 228；再次 Dry Run/apply
  创建 0；缺确认参数以退出码 2 拒绝。
- 备份恢复：校验和、空目标恢复、前向 Migration、Revision 原文/哈希、
  当前/基线指针、应用健康、非空拒绝和卷隔离通过。
- 自动部署、安装自动部署、部署缓存清理三套集成测试通过。
- Wiki 检查 226 个文件通过；typecheck、build、Drizzle check、Shell 语法和
  `git diff --check` 通过。
- build 仅有基线已有的 6 个 `/images/*` 运行时解析 warning，退出码为 0。

### 验证修复记录

- 首次专用测试误传 `DATABASE_URL` 而被安全护栏 skip；未计作通过，改用
  `TEST_DATABASE_URL` 后 9 项实际执行并通过。
- 备份夹具的 `psql --command` 多行变量和同语句 CTE 可见性导致两次预期失败；
  改为标准输入和顺序 `DO` 块后完整演练通过。这些失败均只发生在本轮临时测试环境。

### 安全和生产资源边界

- 没有取得或使用生产密钥。
- 只使用本轮创建、名称含 `test` 的隔离 PostgreSQL 17 容器和临时数据库。
- 备份恢复使用 `/tmp`、隔离 Compose project、临时卷和无效外部地址，退出时清理。
- 没有连接生产 PostgreSQL、S3/COS、服务器或独立内容仓库。
- 没有 Push、部署、发布镜像、修改生产部署行为或进入阶段 2。

### 已知限制

- 已删除或当前缺失文章不会从 Git 历史猜测回填，当前 Revision 指针保持可空。
- 文件系统不参与 PostgreSQL 锁；实际运维回填仍应暂停内容发布，并在同一只读
  工作树完成 Dry Run 和 apply。
- 阶段 2 前的新发布和恢复不会追加 Revision，`drafts.base_revision_id` 也尚未由
  V1 草稿流程主动写入。
- CLI 报告只写 stdout；持久报告、保留和自动清理属于后续运维阶段。

### 回滚

优先普通 `git revert <阶段1-commit-sha>` 回滚应用。`0011` 是 expand-only；
数据库已执行时可保留新表和可空列，旧应用可安全忽略。不要自动删除 Revision。
单次回填失败由事务自动回滚；保存报告、修复 blocker 后重新 Dry Run，不要删除历史
或改写 Markdown 规避冲突。隔离环境需要物理删除 Schema 时，必须先备份并确认没有
阶段 2 数据，具体 SQL 见 `docs/v2/PHASE_V2_1_ACCEPTANCE.md`。

### 人工验收

维护者应在隔离 PostgreSQL 17：

1. 核对阶段 1 Commit 只含 Schema、Migration、回填、测试和文档。
2. 分别在空库和 V1 数据副本运行 Migration，确认旧行数量与内容不变。
3. 同步 228 篇 V1 索引，运行默认 Dry Run，确认 228 待创建、0 blocker。
4. 带双确认执行 apply，确认创建/链接各 228，再运行两次确认幂等。
5. 抽查新闻、普通 Wiki 和含扩展语法 Wiki 的完整原文、正文、Frontmatter 与 SHA。
6. 人为制造文件漂移和事务失败，确认 fail closed 且没有半回填。
7. 重跑完整 CMS 和备份恢复，手工确认 V1 前台、编辑、审核、发布、历史和恢复不变。
8. 确认没有独立内容仓库写入、生产连接、Push 或部署。
9. 全部接受后明确回复“V2 阶段 1 验收通过”。

详细命令、预期结果、失败处理、回滚和安全注意事项见
`docs/v2/PHASE_V2_1_ACCEPTANCE.md`。

### Commit

本记录将与阶段 1 独立 Commit 一同提交。最终不可循环自引用的 Commit SHA 由阶段 1
最终回复报告；在提交完成前不预填或猜测 SHA。

## 2026-07-29：V2 阶段 1——维护者人工验收收尾

### 完成状态

- 实现：阶段 1 实现 Commit
  `42ca85976552fe483b80afd9050e99fd28422b2c` 保持不变。
- 自动化验证：阶段 1 全部通过。
- 人工验收：通过。
- V2 总体进度：阶段 1 已勾选完成。
- 下一阶段是否开始：否；本次仅记录验收结果，阶段 2 需维护者另行要求。

### 维护者确认

- 确认时间：2026-07-29。
- 前置执行反馈：`完全和你说的一样，执行完毕了`
- 验收确认原文：`V2 阶段 1 验收通过`

维护者在隔离 PostgreSQL 环境完成了 Migration、V1 内容索引、228 篇 Dry Run、
实际回填和幂等复验，并随后给出阶段 1 的明确验收原文。

### 验收记录变更

- 勾选 V2 总体进度中的阶段 1。
- 勾选阶段 1 全部人工验收项。
- 更新阶段 1 验收结论、确认日期、实现 Commit 和维护者原文。
- 保持阶段 2 及后续阶段的总体、实现、验证和人工验收项全部未勾选。

### 数据库、API、依赖和生产资源

本次收尾只修改需求复选框、验收记录和追加式交接文档：

- 没有新增或执行 Migration。
- 没有修改数据库 Schema、API、依赖、环境变量或运行时。
- 没有连接生产 PostgreSQL、S3/COS、服务器或独立内容仓库。
- 没有 Push、部署、发布镜像或进入阶段 2。

## 2026-07-29：V2 阶段 2——Revision 影子写入、历史和恢复数据库化

### 完成状态

- 实现：阶段 2 实现完成。
- 自动化验证：全部通过。
- 人工验收：等待维护者验收；人工验收项和阶段总体完成均未勾选。
- 下一阶段是否开始：否；未进入阶段 3。

### 基线

- 开始分支为 `main`，HEAD 为阶段 1 验收收尾 Commit
  `383db3152dac6301001c5b8738ee2f17c41e566c`。
- 阶段 1 实现 Commit 为 `42ca85976552fe483b80afd9050e99fd28422b2c`。
- `origin/main` 为 `1752363a306d9c6bc0b44d1eb8a6ce359444637d`；本地领先 5。
- 阶段 2 开始时工作区干净，没有发现适用的 `AGENT.md` 或 `AGENTS.md`。
- 没有覆盖、丢弃、暂存或回退任何来源不明改动。

### 实现内容

- 新增测试环境专用 `CONTENT_PUBLISH_MODE=revision_shadow`。默认
  `legacy_git` 保持 V1；非 `NODE_ENV=test` 的影子模式、未知值和阶段 2 的
  `database` 均 fail closed。
- Git Push 成功后，在同一后续数据库事务内追加 Revision，并同时更新
  `articles.current_revision_id`、草稿 `base_revision_id`/旧哈希、V1 publish
  record 和审计。
- Revision 记录完整 Markdown、正文、Frontmatter、SHA-256、发布者、审核者、
  来源草稿、V1 operation UUID 和 Git Commit SHA。
- `source_operation_id` 和 `(article_id, git_commit_hash)` 唯一；追加时锁定文章行。
  同 operation 重放返回既有 Revision，字段漂移 fail closed。
- Push 失败发生在 Revision 事务之前，不创建正式 Revision；并发发布最多一个成功，
  成功后重试也不重复。
- 原 Git 历史、详情、Diff 和恢复入口完整保留。Git 恢复在影子模式下追加新的
  `restore` Revision。
- 增加 DB 历史列表、详情、正文 Diff 和从不可变 Revision 恢复的影子服务/API。
  读取要求登录；恢复要求管理员、同源和 CSRF；未开启影子模式时 API 隐藏为 404。
- 增加只读 Git/Revision 对账 CLI，核对发布时间、文章作者、发布者、审核者、来源
  草稿、正文、完整原文和 SHA，并报告未匹配 Git Commit。没有自动修复模式。
- 对账使用一对一匹配：显式 Commit 关联优先；阶段 1 backfill 只允许以完整原文和
  SHA 推断到尚未占用的 Git Commit。
- 完整 CMS 测试入口纳入阶段 2 套件；阶段 1 Migration 测试改为显式定位 `0011`，
  不再错误假设它永远是迁移目录最后一个文件。

### 数据库、API、依赖和环境变量

- 新增 expand Migration `0012_fuzzy_roxanne_simpson.sql`、Drizzle snapshot 和
  journal 记录。
- 新增可空 `article_revisions.source_operation_id`、`git_commit_hash`、外键和两个
  唯一索引；旧 backfill 行保持可空，旧字段和旧数据不改。
- 新增 API：
  - `GET /api/cms/articles/:id/revisions`
  - `GET /api/cms/articles/:id/revisions/:revision`
  - `GET /api/cms/articles/:id/revisions/diff?from=<uuid>&to=<uuid>`
  - `POST /api/cms/articles/:id/revisions/:revision/restore`
- 新增 CLI：`npm run v2:revisions:compare`。
- 新增环境变量：`CONTENT_PUBLISH_MODE`；`.env.example` 和 Compose 默认均为
  `legacy_git`。
- 新增或升级 npm 依赖：无；`package-lock.json` 未变化。

### 一致性比较结果与已知差异

隔离集成测试文章最终有 6 个 Revision 和 6 个 Git Commit：

- mismatch 0；
- unmatched Git Commit 0；
- 首个 backfill Revision 通过完整原文/SHA 推断到初始 Commit；
- 后续发布和两类恢复通过显式 operation UUID/Commit 一一关联；
- 发布时间、作者、审核、正文和哈希检查全部通过。

真实仓库中 V2 前的历史存在设计上已知差异：阶段 1 只回填每篇文章当时的当前版本，
没有导入过去每个 Git Commit。对真实长历史文章运行报告时，旧提交可能显示为
`unmatchedGitCommits`。本阶段只报告，不猜测补写、不删除历史、不自动修正生产数据。

### 自动化验证

- 阶段 2 专用：1 个文件、7 项通过；测试内实际运行对账 CLI。
- 完整 CMS：10 个文件、57 项通过，包含 V1 发布集成回归。
- 全新隔离 PostgreSQL 17 数据库重放全部 Migration 通过，并核对 2 列和 2 唯一索引。
- 备份恢复：checksum、空目标恢复、forward Migration、应用健康、非空拒绝和卷隔离
  通过。
- 自动部署、自动部署安装、部署缓存清理三套集成测试通过。
- Wiki 检查 226 个文件通过。
- Drizzle check、Shell 语法、`npm run typecheck`、`npm run build` 和
  `git diff --check` 通过。
- build 保留基线已有 6 个 `/images/*` 运行时解析 warning，退出码 0；没有新增
  build error。

### 验证修复记录

- 首轮阶段 2 对账测试将 backfill 首版误推断到后来恢复出的相同内容 Commit，造成 1
  个旧 Commit 未匹配；修正为显式关联优先的一对一匹配后，7 项全部通过。
- 首轮完整 CMS 中 49/50 项通过；唯一失败是阶段 1 测试把最后 Migration 写死为
  `0011`。改为按编号定位后，完整 CMS 57/57 通过。
- 一次备份恢复并行调用在外层工具返回时仍在运行，未据此宣称成功；等待其自然清理后
  单独重跑并取得明确退出码 0。
- 影子开关首次拒绝后曾缓存非法值；代码审查发现后改为验证通过才缓存，并增加重复
  fail-closed 测试。

### 安全和生产资源边界

- 没有取得或使用生产密钥。
- 没有连接、迁移、停止或修改既有 `vinci-cms-postgres`。
- CMS/Migration 测试使用本轮创建、名称明确含 phase2/test 的 PostgreSQL 17 容器和
  临时数据库；结束后容器自动删除。
- Git 测试全部使用 `/tmp` 下临时本地 bare remote/worktree，结束后删除。
- 备份恢复使用隔离 Compose project、临时 volume、无效外部地址和测试凭据，结束后
  清理。
- 没有访问生产 PostgreSQL、S3/COS、服务器、代码仓库远端写端点或独立内容仓库。
- 没有修改 `content/**/*.md`，没有 Push、部署、发布镜像或进入阶段 3。

### 已知限制

- Git 与 PostgreSQL 无法形成跨系统原子事务。只有 Git Push 和随后 DB 事务均成功时
  API 才返回成功；若 Push 后数据库永久失败，对账会把该 Commit 报为未匹配，但不会
  自动修复。
- backfill Revision 没有 operation/Commit 显式关联，只能按原文和 SHA 推断。
- DB 历史 API 只在测试影子模式开放，前台和正式 CMS 历史仍使用 Git。
- `legacy_git` 不追加 Revision，这是阶段 2 的明确回滚开关。
- 对账报告只写 stdout；人工落盘必须放受控测试目录并按本地保留策略清理。持久报告的
  有界保留和自动清理属于后续运维阶段。
- `members` 不在本阶段，属于阶段 9。

### 回滚

将 `CONTENT_PUBLISH_MODE` 设回 `legacy_git` 即可关闭影子写入和 DB 历史 API；保留已
写 Revision 作为审计记录，不删除。应用使用普通
`git revert <阶段2-commit-sha>`，再运行完整测试、typecheck、build 和 diff check。
`0012` 为 expand-only，旧应用可忽略，优先保留；不得自动 down、删除 Revision、
hard reset 或 Force Push。

详细配置回滚、数据库边界、Git 新提交恢复和安全注意事项见
`docs/v2/PHASE_V2_2_ACCEPTANCE.md`。

### 人工验收

维护者应在隔离 PostgreSQL 17、测试 Git remote 和独立 worktree：

1. 核对 Commit 范围，不含内容、前台来源、Nuxt Content 移除或生产部署切换。
2. 重放 Migration，确认旧数据不变和新列/索引存在。
3. 启用测试影子模式，首次和再次发布同一文章，核对 Revision 单调递增和全部关联。
4. 并发及成功后重试，确认只产生一个 Revision。
5. 模拟测试远端 Push 失败，确认 Revision 数量不变；修复后重试只追加一次。
6. 对比 DB/Git 历史、详情和正文 Diff；关闭开关后 DB API 404、Git 入口仍可用。
7. 分别从 Git 版本和 DB Revision 恢复，确认都以新 Commit/Revision 追加。
8. 验证成员读取、管理员恢复、CSRF/Origin 和审计。
9. 运行对账并逐条解释任何 unmatched V2 前提交；不得自动修复。
10. 重跑全部自动验证，确认无生产连接、Push 或部署。
11. 全部接受后明确回复“V2 阶段 2 验收通过”。

### Commit

本记录将与阶段 2 独立 Commit 一同提交。最终不可循环自引用的 Commit SHA 由阶段 2
最终回复报告；在提交完成前不预填或猜测 SHA。

---

## 2026-07-29：阶段 3 Comark 兼容验证、CodeMirror 和最终预览

### 推进授权和基线

- 维护者要求把阶段 2 人工验收延后，与阶段 3 一起执行，并明确授权直接实施阶段 3。
- 阶段 2 人工验收和总体完成没有因此代勾；联合步骤已写入
  `docs/v2/PHASE_V2_3_ACCEPTANCE.md`。
- 分支：`main`。
- 阶段 3 起始 HEAD：`7cdc8c330042e10a1810b5b784ff38fc63ea007e`。
- 开始时 `origin/main`：`1752363a306d9c6bc0b44d1eb8a6ce359444637d`。
- 开始时工作区干净；没有覆盖、丢弃、暂存、回退或改写既有提交。
- 没有发现适用的 `AGENT.md` 或 `AGENTS.md`。

### `{% include ... %}` 结论

- 实际内容只在张彦斐、宫金良、巩丽三篇教师资料末尾存在
  `{% include section.html %}`。
- 当前仓库、全部可达 Git 对象和初始可见提交中均不存在 `section.html` 或
  `_includes`，Nuxt Content 不执行 Liquid include。
- 按维护者明确授权，仅精确删除三处无输出尾行及其前导空行，共 84 bytes；教师正文和
  Frontmatter 完整保留，没有批量格式化 Markdown。
- 测试和文档中的未知模板语法继续保留。兼容层在非代码文本中把它们安全显示出来，
  代码块与行内代码保持原文，防止静默删除。

### 实现

- 固定 `@comark/nuxt@0.5.1`，增加共用 `VinciMarkdownRenderer` 和 Vinci Markdown
  兼容层；生产新闻、Wiki、成员前台仍使用 Nuxt Content。
- 兼容 `<NuxtLink>`、MDC/Vue、原始 HTML、GFM 表格/任务、Shiki 代码高亮、
  GitHub 风格标题 ID 和目录。
- XSS 边界阻断可执行标签、事件属性和危险 URL；被阻断内容显示为安全代码提示，
  兼容 HTTPS iframe。
- 草稿源码模式替换为 CodeMirror 6，客户端初始化失败时回退 `textarea`；新增最终
  效果预览，形成可视化、源码、最终预览三模式。
- 模式切换不做每键双向重建、不直接调用保存；图片上传按可视化/源码/预览当前模式
  插入，继续复用既有锁、CSRF、权限和自动保存链路。
- 新增可复现批量审计和阶段 3 专项测试。

### 兼容报告

`docs/v2/PHASE_V2_3_COMARK_COMPATIBILITY.json` 保存全部 260 篇逐文件 SHA、旧/新 AST
摘要、语法和差异：

- 260 篇扫描，260 篇 Comark 解析成功，0 render failure。
- 227 篇比较无差异，33 篇存在 35 项已记录差异。
- 差异为 22 项 `br`、10 项 `a`、1 项 heading 数量、1 项 heading ID/text 和
  1 项 `pre` 数量。
- 审计时安全插件还对 XML 风格代码示例中的 `width:int`、`height:int`、
  `pitch:float`、`yaw:float` 打印属性移除警告；正文文件未被修改。
- 这些差异是阶段 4 影子 HTTP/DOM 比较的输入，阶段 3 没有据此授权生产切换。

### 数据库、API、依赖和环境变量

- 数据库：无 Migration、无模型或数据变化。
- API：无变化。
- 环境变量和生产配置：无变化。
- 新运行依赖：
  `@comark/nuxt@0.5.1`、`@nuxtjs/mdc@0.22.2`、`codemirror@6.0.2`、
  `@codemirror/lang-markdown@6.5.1`、`@codemirror/state@6.5.2`、
  `@codemirror/view@6.39.16`、`github-slugger@2.0.0`、
  `@shikijs/themes@4.3.1`。
- 新开发依赖：`@vue/server-renderer@3.5.40`。
- 安装时 `npm audit`：0 vulnerabilities。

### 最终自动验证

- `npm run v2:comark:audit -- --write`：通过；260/260，0 失败，33 篇/35 项差异。
- `npm run test:v2:phase3`：通过；1 个文件、7 项测试。
- 隔离 PostgreSQL 17 上
  `TEST_DATABASE_URL='<phase3-test-url>' npm test`：通过；11 个文件、64 项测试。
- `npm run v2:phase0:audit`：通过；260 篇、0 symlink、0 include；内容 manifest
  SHA-256 为 `db36a4ef8c696d95662d5e1cac6c5fd5792ae02610ed6e5aab36d25ef1fe5ede`。
- `npm run wiki:check`：通过；226 个 Wiki 文件。
- `npm run test:backup-restore`：单独重跑并明确退出码 0；校验和、空目标恢复、前向
  Migration、恢复标记、应用健康、非空目标拒绝、隔离卷均通过。
- `./tests/auto-deploy.integration.sh`：通过。
- `./tests/install-auto-deploy.integration.sh`：通过。
- `npm run test:deploy-cache-cleanup`：通过。
- `npm run typecheck`：通过。
- `npm run build`：通过；保留既有六条 `/images/...` 构建期解析警告，没有错误。
- `git diff --check`：通过。

专项测试首次新增静态断言时错误地要求精确 `"shiki"` class、错误的默认模式/变量名和
预览绑定名；根据实际稳定行为收窄断言后 7/7 通过，没有为了满足测试改动正确运行代码。
Comark 类型接入和 Nitro shared import 在较早构建中暴露的问题均已修复，最终
typecheck/build 以本记录所列结果为准。

### 生产资源边界

- 完整测试只使用本轮创建并已删除的 `vinci-v2-phase3-final-test-db` PostgreSQL 17
  容器；没有连接或修改既有数据库。
- 备份恢复只使用测试脚本创建的 `/tmp` 根、隔离 Compose project、测试镜像和临时
  volume，测试结束后清理。
- 自动部署测试只使用 `/tmp` 本地 bare remote/worktree 和测试替身。
- 没有取得或使用生产密钥，没有访问生产 PostgreSQL、S3/COS、服务器或远端写端点。
- 没有接入 `SDUTVINCI/sdutvinci_content` 写权限，没有 Push、部署或进入阶段 4。

### 已知限制

- 33 篇的 35 项结构差异仍需阶段 4 影子 HTTP/DOM 比较和人工视觉判断；阶段 3 只保证
  全量解析、显式报告和安全预览，不声称像素或 DOM 完全相等。
- XSS 策略为了兼容现有内容保留 HTTPS iframe；未来生产接入前仍需确定允许域策略。
- CodeMirror 是客户端组件，SSR/禁用 JavaScript 时使用加载或 `textarea` 回退。
- 三模式最终视觉、真实中文输入法、浏览器上传、编辑锁和自动保存仍需人工联合验收。
- 阶段 2 人工验收仍未完成，阶段 2/3 总体完成项均保持未勾选。

### 回滚和人工验收

- 阶段 3 无数据库 down。应用回滚使用
  `git revert <阶段3-commit-sha>`，然后重跑完整测试、typecheck、build 和 diff check。
- 不得 hard reset、Force Push、批量覆盖 `content/` 或删除 Revision 历史。
- 阶段 2 影子链路异常时切回 `CONTENT_PUBLISH_MODE=legacy_git`，保留 Revision 审计。
- 三处 include 如需恢复，必须用新的审查 Commit 精确恢复，不能推测模板输出。
- 完整的阶段 2 + 3 联合人工验收、预期结果、失败处理、安全注意事项和明确回复文本见
  `docs/v2/PHASE_V2_3_ACCEPTANCE.md`。

### Commit

本记录将与阶段 3 独立 Commit 一同提交。最终不可循环自引用的 Commit SHA 由阶段 3
最终回复报告；在提交完成前不预填或猜测 SHA。

---

## 2026-07-29：阶段 2 联合验收的运行时 `NODE_ENV` 修复

### 现场现象和只读确认

- 维护者在阶段 2 首次影子发布中点击“确认发布到 Git”，页面只显示
  `Server Error`。
- 读取隔离验收服务日志后确认实际异常为：
  `revision_shadow 只允许在 NODE_ENV=test 的隔离环境启用`。
- `/proc` 中该服务的外部环境实际为 `NODE_ENV=test`、
  `CONTENT_PUBLISH_MODE=revision_shadow`，未读取或输出数据库 URL、Token 或密钥。
- 原因是验收运行生产 `.output`，bundler 把直接的 `process.env.NODE_ENV` 静态折叠
  成构建时 `production`；直接运行 TypeScript 的集成测试没有覆盖这一产物差异。
- 只读数据库查询确认目标草稿仍为 `approved`、版本 22、publish attempt 为 0。
- 配置的隔离 CMS Git worktree 尚不存在，证明错误发生在 publish record、文件写入、
  Commit 和 Push 之前；可以在重建服务后安全重试一次。

### 修复

- `server/utils/cms-v2-flags.ts` 改为
  `Reflect.get(process.env, 'NODE_ENV')`，使生产构建读取真实运行时边界。
- `revision_shadow` 在非测试运行时仍 fail closed，没有放宽生产保护。
- 新增 `CmsV2ConfigurationError`，发布 API 将配置错误映射为明确的 503 信息，不再
  退化为通用 `Server Error`。
- 阶段 2 集成测试增加运行时读取和禁止可静态折叠写法的回归断言。
- 阶段 2、阶段 3 联合验收文档增加旧构建不可复用、构建产物检查、重启和安全重试说明。

### 自动验证

- 首次测试容器数据库名没有独立 `test` 段，被测试安全护栏在执行任何测试前拒绝；
  该空容器已删除，未把这次拒绝计为测试通过。
- 合规命名的隔离 PostgreSQL 17：
  `npm run test:v2:phase2` 通过，1 个文件、7 项测试。
- 同一隔离库完整 `npm test` 通过，11 个文件、64 项测试。
- `npm run typecheck` 通过。
- `npm run build` 通过；只有既有静态图片解析警告。
- 构建产物检查通过：
  `.output/server/chunks/nitro/nitro.mjs` 保留
  `Reflect.get(process.env, "NODE_ENV")`。
- 临时 PostgreSQL 容器已停止并自动删除。
- 最终 `git diff --check` 和提交后状态由本修复最终记录补充。

### 生产资源和回滚

- 只读取维护者正在使用的隔离验收服务日志、两个非敏感运行时开关、隔离草稿状态和
  隔离 Git worktree 状态。
- 没有修改维护者的隔离数据库、草稿、测试 remote 或旧验收进程；没有接触生产资源。
- 没有 Push、部署或进入阶段 4。
- 回滚使用 `git revert <本修复-commit-sha>`；本修复无 Migration 或环境变量变化。
- 修复后必须从新 Commit 重新构建 `.output`，旧进程不能热更新该服务端逻辑。

### Commit

本记录将与验收修复的独立 Commit 一同提交。最终不可循环自引用的 Commit SHA 由最终
回复报告；在提交完成前不预填或猜测 SHA。

---

## 2026-07-29：阶段 2 再次提交的影子文章索引修复

### 现场证据和根因

- 维护者首次影子发布成功后，数据库已有 1 个 Revision；它的 Git Commit SHA 与隔离
  CMS worktree、本地 bare 测试远端一致。
- 第二次编辑正文后，提交审核被提示“当前文章已有更新，请重新同步后再发布”。
- 只读 SQL 确认草稿基线哈希、文章投影哈希和 Git 文件 SHA-256 相同，但文章
  `is_present=false`；第二次正文仍保存在原隔离草稿中。
- 隔离 Git 文件存在于 `CMS_GIT_WORKTREE/content/wiki/v2-phase2-acceptance.md`，
  而隔离 app 的静态 `CMS_CONTENT_ROOT` 没有该首次发布文件。
- 根因是文章列表和仪表盘请求继续执行 V1 全量内容同步，扫描旧静态构建副本并把新文章
  误标为不存在；并发保护随后按设计拒绝提交。

### 修复

- 新增请求级文章刷新边界：`legacy_git` 保持 V1 同步；`revision_shadow` 跳过请求内
  静态内容全量同步。
- 影子模式文章详情优先读独立 CMS Git worktree；只有文件尚不存在的 `ENOENT` 才回退
  到 `CMS_CONTENT_ROOT`，权限、配置等其他错误继续抛出。
- 阶段 2 回归测试把静态内容根固定在发布前状态，首次发布后访问列表和详情，确认文章
  不被标成 missing、哈希仍为 Git 当前值且正文来自新提交。
- 阶段 2、阶段 3 联合人工验收文档增加现场根因、保留现有草稿的一次性修复同步、重建
  重启、验证、失败处理和回滚步骤。

### 自动验证

- 名称明确含 test 的隔离 PostgreSQL 17：
  `npm run test:v2:phase2` 通过，1 个文件、7 项测试。
- 同一隔离库完整 `npm test` 通过，11 个文件、64 项测试。
- `npm run typecheck` 通过。
- `npm run build` 通过。
- 临时 PostgreSQL 容器已停止并自动删除。
- 最终 `git diff --check` 和提交后工作区状态由本修复最终记录补充。

### 变更边界、限制和回滚

- 没有 Migration、API、依赖或环境变量变化。
- 没有修改维护者当前隔离数据库、草稿、Git remote、worktree 或进程；只做只读诊断。
- 没有访问或修改生产 PostgreSQL、服务器、对象存储或真实内容仓库；没有 Push、部署
  或进入阶段 4。
- 当前已被旧进程标为 missing 的隔离投影需按阶段 2 文档第 16.3 节做一次显式同步；
  代码不会在请求中擅自改回，以免隐藏其他真实内容删除。
- 回滚使用 `git revert <本修复-commit-sha>` 并重跑专项、完整测试、typecheck、build
  和 diff check；不得删除 Revision、hard reset 或 Force Push。

### Commit

本记录将与阶段 2 验收热修复的独立 Commit 一同提交。最终不可循环自引用的 Commit
SHA 由最终回复报告；在提交完成前不预填或猜测 SHA。

---

## 2026-07-29：人工验收库与破坏性自动测试隔离修复

### 现场事实

- 维护者完成 5 个 Revision 的发布、恢复和单文章对账后，按旧验收命令执行
  `TEST_DATABASE_URL="$DATABASE_URL" npm run test:v2:phase2`。
- 专项测试 7/7 通过，但测试 `beforeAll` 会 TRUNCATE CMS 业务表，因此人工验收文章
  UUID 随后已不存在，数据库只剩测试夹具 `news/phase-two.md`。
- 受影响的仅是名称含 test 的一次性隔离 PostgreSQL；没有连接生产数据库。
- 隔离内容 worktree 和 bare remote 仍完整保留 5 个验收 Git Commit；运行测试前保存
  的 `revision-compare.log` 记录 article/revision/git commit 均为 1/5/5，
  mismatch 和 unmatched commit 均为 0。
- 验收根目录未发现数据库 dump，不能声称可恢复被 TRUNCATE 的人工数据库现场。

### 修复

- 测试数据库护栏现在同时读取进程启动时的 `TEST_DATABASE_URL` 与 `DATABASE_URL`，
  忽略凭据、规范化主机/默认端口/数据库名后比较目标；指向同一数据库时在 Migration
  或 TRUNCATE 前 fail closed，并明确说明集成测试会清空 CMS 业务表。
- 安全单元测试覆盖相同目标拒绝和独立自动测试库允许。
- 阶段 2/3 验收文档明确要求人工验收库与一次性 `automated_test` 数据库分离，禁止
  `TEST_DATABASE_URL="$DATABASE_URL"`，并要求自动测试结束后只清理自动测试库。

### 边界与后续

- 本修复没有 Migration、API、运行时依赖或生产环境变量变化。
- 旧人工验收数据库内容已不可逆地被隔离测试夹具替换；不伪造或手工拼接审计历史。
- 已完成的 Git、界面和对账证据仍有效；后续自动测试改用第二个隔离数据库。
- 没有 Push、部署或进入阶段 4。

### Commit

本记录将与自动测试隔离修复的独立 Commit 一同提交；SHA 由最终回复报告。

补充：`scripts/test-cms.sh` 不再在测试护栏读取前删除调用者的 `DATABASE_URL`；数据库
测试仍由 helper 在连接前删除应用 URL 并换成已验证的 `TEST_DATABASE_URL`。因此专项
Vitest、完整 `npm test` 和 `npm run test:cms` 三种入口都能拒绝同库配置。

---

## 2026-07-29：shadow 路径安全错误契约统一

- 维护者在独立自动测试库运行 `npm run test:cms` 时，终端仍显式启用了
  `revision_shadow`；恶意 `../../.env` 路径被正确拒绝，但 Git worktree 路径校验返回
  中文错误，测试只接受静态内容读取器的 `CONTENT_PATH_OUTSIDE_ROOT`，因此 57/58。
- 两条读取路径现统一返回 `CONTENT_PATH_OUTSIDE_ROOT`。没有放宽路径、扩展名、绝对
  路径或目录穿越校验，也没有读取目标文件。
- 阶段 2 的既有 7 项测试内新增 shadow Git 路径回归断言，不增加或伪造测试项数量。
- 本修复没有 Migration、API、依赖或环境变量变化；没有接触生产资源。

---

## 2026-07-29：备份恢复测试的调用环境隔离

- 阶段 2 人工验收终端保留了 `DATABASE_URL`、PostgreSQL、CMS Git 和 shadow 开关；
  Docker Compose 的 shell 环境优先级高于测试生成的 `.env`，旧脚本可能被这些变量
  覆盖，不能直接作为安全验收命令。
- `tests/backup-restore.integration.sh` 现在在创建任何目录、容器或 Migration 前清除
  全部应用专用数据库、Compose、CMS Git、对象存储、认证和恢复确认覆盖变量；Docker
  连接自身需要的通用环境不变。
- 隔离测试仍只使用动态 phase9 project、test 数据库、无效外部端点、临时备份根和独立
  volume；退出 trap 清理精确匹配本次动态标签的测试镜像、容器、volume 和临时目录。
