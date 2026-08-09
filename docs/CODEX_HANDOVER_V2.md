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

---

## 2026-07-29：阶段 2 维护者人工验收通过

- 维护者确认原文：`V2 阶段 2 验收通过，接受已记录的登录后 Revision API 404 复验限制。`
- 人工验收已覆盖隔离 Git/数据库首次与再次发布、Revision 递增、Push 失败不写正式
  Revision、Git/数据库恢复、权限、Diff 和只读对账；保存的对账报告为 1 篇文章、
  5 个 Revision、5 个 Git Commit、0 mismatch、0 unmatched。
- 专项测试 7/7、完整 CMS 测试 58/58、备份恢复、部署缓存清理、typecheck、build 和
  diff check 均通过；隔离仓库与原源码仓库工作区干净。
- 人工验收库曾被旧破坏性测试命令覆盖，切回 `legacy_git` 后无法再使用原管理员完成
  已登录 Revision API 404 复验。已有 Wiki 返回 200，隔离 Git worktree 与 bare
  remote 均保留验收内容且 HEAD 一致，运行模式和开关断言通过；维护者明确接受此项
  未完成复验，不将其伪造为已执行。
- 阶段 2 总体完成项和实际完成的人工验收项已勾选。没有 Push、部署、生产资源访问或
  内容仓库写入；阶段 3 实现已完成，等待人工验收。

---

## 2026-07-29：阶段 3 维护者人工验收通过

- 维护者确认原文：`V2 阶段 3 验收通过；我接受 33 篇/35 项差异留到阶段 4 影子对比，并确认未切换生产前台、内容权威或发布事务。`
- 维护者按精简人工路径检查普通 Wiki 的可视化编辑、CodeMirror 源码和 Comark 最终
  预览，并抽查含代码、表格、图片、目录、`<NuxtLink>` 和原始 HTML 的复杂 Wiki。
- 维护者确认模式切换和保存未破坏 Markdown，最终预览可作为后续正式前台候选。
- 兼容报告结论保持为 260/260 解析成功、0 渲染失败、227 篇无差异，以及 33 篇共
  35 项已记录差异；差异不在阶段 3 隐瞒或自动改写，进入阶段 4 影子 HTTP/DOM 对比。
- 阶段 3 总体完成项和实际完成的人工验收项已勾选。阶段 4 尚未开始；没有 Push、
  部署、生产资源访问、内容权威切换、发布事务修改或内容仓库写入。

---

## 2026-07-29：V2 阶段 4——前台数据库读取与 Comark 影子运行

### 完成状态

- 实现：完成。
- 自动化验证：完成。
- 人工验收：等待维护者确认，阶段 4 总体完成项保持未勾选。
- 下一阶段是否开始：否；不得开始阶段 5。

### 基线与资源边界

- 开始实施时分支为 `main`，HEAD 为
  `a3f7b77e4de7cdfb23e01e7b2b8b70cbad0104b0`，工作区干净。
- 本机的 `origin/main` 远程跟踪引用已与 HEAD 相同，和交接中记录的
  `d50e715d8e99b5f20a3c543851d3cdb665db071f` 不同；没有 fetch、pull、rebase、
  reset 或改写本地提交。
- 旧 `/tmp/vinci-v2-phase2-acceptance.*` 和既有容器只读盘点后保持原状。
- 自动验证仅创建 `vinci-v2-phase4-test-db` /
  `vinci_v2_phase4_test`，绑定 `127.0.0.1:55444`；测试完成后精确删除。
- 未访问生产数据库、生产容器、服务器、对象存储、GitHub 写权限或独立内容仓库；
  没有 Push 或部署。

### 修改内容

- 增加新闻、Wiki、成员和搜索统一数据库查询服务。新闻/Wiki 从
  `articles.current_revision_id` 读取当前 Revision，排除删除和缺失内容。
- Wiki 候选提供文档根、目录、章节顺序、上一页和下一页；成员仅提供数据库结构化
  候选，正文仍只读 legacy 文件，不切换成员权威。
- 新闻、Wiki 和成员按集合支持 `legacy_git`、`database_shadow` 和 `database`。
  shadow 并行执行数据库旁路查询但始终返回旧 Nuxt Content 结果。
- 数据库详情由 `VinciMarkdownRenderer` SSR，与 CMS 最终效果预览复用相同 Comark
  和安全管线；页面统一生成 SEO、Open Graph 和 canonical。
- 增加数据库候选搜索、Sitemap、RSS、Revision ID 缓存键及管理员精确失效 API。
  缓存有 5 分钟 TTL 和 512 项上限，失效接口没有接入正式发布事务。
- 动态内容页面改为运行时 SSR，以允许同一测试/预发布构建切换来源；Nuxt Content、
  代码仓库 `content/`、Git-first 发布和生产默认均保留。
- 新闻数据库投影路径兼容旧 Nuxt Content 对文件名非 ASCII 部分的处理，例如
  `2024-07-06-接受赛委会采访.md` 仍映射 `/news/2024-07-06`。

### 数据库、API、依赖和环境变量

- Migration 和 Schema：无变化。
- 新候选读取 API：`/api/v2/content/config`、新闻、Wiki、成员和搜索端点。
- 新 Feed：`/sitemap.xml`、`/rss.xml`；默认关闭时返回 404。
- 新缓存 API：`POST /api/cms/v2/content-cache/invalidate`，要求管理员、同源和
  CSRF；不在发布事务中调用。
- 新开发依赖：`parse5@8.0.1`，用于确定性 HTTP/DOM 报告；无新运行依赖。
- 新变量：`CONTENT_SOURCE_NEWS`、`CONTENT_SOURCE_WIKI`、
  `CONTENT_SOURCE_MEMBERS` 和 `CONTENT_CANDIDATE_ENV`。默认值是
  `legacy_git + disabled`；候选只允许显式 `test` 或 `staging`。

### 测试、构建与差异

- 阶段 4 数据库专项：1 文件，8/8。
- 完整 CMS 回归：11 文件，66/66。
- 普通测试：4 文件、16 项通过；未提供测试 URL 时 8 个数据库文件、57 项安全跳过，
  数据库路径已由完整 CMS 回归覆盖。
- V2 内容审计：260 个 Markdown 通过；Wiki 检查：226 个文件通过。
- typecheck、build、脚本语法、Compose 安全默认配置和 `git diff --check` 通过。
- 默认无数据库冒烟：`/`、`/news`、`/wiki`、`/team` 为 200；候选 API、
  Sitemap 和 RSS 为 404。
- HTTP/DOM 报告比较 270 条路由：267 组双方 200，3 组缺失路径双方 404，0 个状态、
  关键标题或 SEO 缺失级别不匹配，212 条关键 DOM 等价，7 个候选探针全部通过。
- 阶段 3 的 33 篇/35 项差异按源文件完整映射并原样保留；没有改写 Markdown。
  另有 25 条非阻断差异，包括 16 条 description/OG 描述来源差异及 9 条
  Comark 原始 HTML、空白文本或标签/标题结构差异，等待浏览器抽查。

### 已知限制

- 成员在阶段 9 前没有正式 Revision 正文，数据库候选正文仍来自 legacy 文件。
- 候选缓存是有界单进程缓存，多实例失效广播不属于阶段 4。
- shadow 失败只有去敏服务器警告，尚无持久指标系统。
- 33 篇/35 项既有差异及新增 25 条非阻断差异仍需维护者抽查。
- 没有在真实预发布或生产域名运行，本阶段不声称完成部署验收。

### 回滚方法

- 运行时立即回退：三个 `CONTENT_SOURCE_*` 全设为 `legacy_git`，
  `CONTENT_CANDIDATE_ENV=disabled`，然后只重启隔离测试实例。
- 代码回滚：对本阶段独立 Commit 执行 `git revert <SHA>`，再跑专项、CMS 回归、
  typecheck、build 和 diff check。
- 没有 Migration down、Revision 删除、内容仓库操作、hard reset 或 Force Push。

### 人工验收与 Commit

- 浏览器优先步骤、预期结果、失败处理和精确清理见
  `docs/v2/PHASE_V2_4_ACCEPTANCE.md`。
- 完整机器报告见 `docs/v2/PHASE_V2_4_HTTP_DOM_COMPARISON.json`。
- 本阶段独立 Commit SHA 由最终回复报告；未 Push、未部署、未进入阶段 5。

---

## 2026-07-29：阶段 4 维护者人工验收通过

- 维护者确认原文：`V2 阶段 4 验收通过`
- 阶段 4 新闻、Wiki、成员数据库候选、Comark SSR、SEO、数据库搜索、Sitemap、
  RSS、集合级开关、Revision 缓存键和精确失效接口的实现及自动验证已获确认。
- 维护者完成旧 Nuxt Content 与数据库/Comark 候选的浏览器验收，并接受报告中完整
  保留的阶段 3 共 33 篇/35 项差异及阶段 4 额外 25 条非阻断差异。
- 生产默认仍为 `legacy_git + disabled`；Git-first 发布事务、成员权威、Nuxt
  Content 和代码仓库 `content/` 均未切换或删除。
- 阶段 4 人工验收项和总体进度已勾选。阶段 5 具备开始条件，但本次没有开始阶段 5。
- 没有 Push、部署、生产资源访问、内容仓库读写或测试资源遗留。

---

## 2026-07-29：V2 阶段 5——数据库权威与 DB-first 发布事务

### 完成状态

- 实现：完成。
- 自动化验证：完成。
- 人工验收：等待维护者确认，阶段 5 总体完成项保持未勾选。
- 下一阶段是否开始：否；不得开始阶段 6。

### 基线与资源边界

- 开始时分支 `main`，HEAD/main/origin/main 均为
  `ddcb6a38b91e3104c25aacf524491d7cfda4397d`，工作区干净；没有 fetch、pull、
  rebase、reset 或覆盖维护者改动。
- 旧 `/tmp/vinci-v2-phase2-acceptance.*`、`vinci-v2-phase2-acceptance-db` 和普通
  `vinci-cms-postgres` 只读盘点后保持原状。
- 自动验证仅创建 `vinci-v2-phase5-test-db` /
  `vinci_v2_phase5_test`，绑定 `127.0.0.1:55445`；蓝绿测试只在其中短暂创建并删除
  `vinci_v2_phase5_test_expand_contract`。
- 未连接生产数据库、生产容器、服务器、S3/COS、GitHub 写权限或
  `SDUTVINCI/sdutvinci_content`；没有 Push、部署、Worker 或内容仓库导出。
- `content/` tree 保持
  `c621880ed3e8d5f39335555c83ecedef834ffbe5`，没有 Markdown 变化。阶段 3/4 已接受的
  33 篇/35 项及额外 25 条差异原样保留。

### 权威、事务和 Outbox

- 生产运行时及 Compose 默认：
  `CONTENT_PUBLISH_MODE=database`、news/wiki=`database`、
  members=`legacy_git`、候选环境=`production`。开发/测试的无变量回退仍为旧安全模式。
- DB-first 服务在一个 PostgreSQL 事务内锁定草稿和文章、验证 approved/version 与
  `base_revision_id`、构建确定性 Markdown、写成功 publish record、追加不可变
  Revision/更新 current pointer、写唯一 pending Outbox、更新草稿基线/状态/版本并写
  审计。事务内没有 Git/GitHub、文件写入或导出等待。
- `content_export_jobs` 保存 target、Revision、操作、状态、幂等键、attempt、
  next-attempt、错误、导出 Commit 和时间戳；全局幂等键和非空
  `(revision_id, operation)` 唯一。阶段 5 只写 pending，不建立或启动 Worker。
- 发布提交后才按 collection/article UUID 精确清缓存并返回 Revision 与
  `waiting_export`；Git 配置是无效地址、worktree/content 目录不存在时仍成功。
- 并发请求通过文章行锁序列化 Revision Number，唯一索引兜底；旧 base Revision
  直接 409，不能覆盖当前正式版本。

### 历史、恢复、删除和后台

- 正式历史、版本详情和正文 Diff 改读数据库 Revision UUID。恢复旧版复制所选内容，
  追加新 Revision、Outbox 和审计，不改写历史。
- 删除以数据库 current Revision 立即下线并写 Outbox/审计；恢复删除复制 current
  Revision、追加新 Revision 并立即上线。普通发布拒绝隐式恢复已删除文章。
- CMS 文章详情在 DB 模式直接读取 current Revision，不再旁路读取 Nuxt Content；
  显示 Revision Number/UUID 以及等待导出、失败、同步、落后或未跟踪的安全占位。
- 草稿和审核比较在 DB 模式使用 base/current Revision；重新同步同时更新 hash 与
  Revision，之后必须重新审核。

### Migration、蓝绿与回滚

- Migration `0013_charming_iceman.sql` 只新增 Outbox、删除事件的可空
  Revision/Outbox 关联，并放宽旧 Commit 字段 NOT NULL；无表/列删除或破坏性 down。
- 隔离兼容测试先应用 0000～0012 并执行旧删除写法，再应用 0013 并再次执行同一旧
  写法，均成功。旧 Git-first 源码、字段、Nuxt Content、`content/` 全部保留。
- 完整回滚必须同时设 publish/news/wiki/members 为 `legacy_git`、候选环境为
  `disabled`。基础 Compose 在 DB-first 模式不要求或挂载 Git 写凭据；显式
  `compose.git-first.yaml` overlay 才挂载 key/known_hosts，缺失时 fail closed。
- `v2:phase5:consistency` 是只读 DB 检查，覆盖 pointer、投影、Revision 序号、
  草稿基线、发布/审计/Outbox 和删除事件关联；不访问 Git、不自动修复。

### 自动验证

- 阶段 5 专项：1 文件，14/14。
- 完整 CMS 回归：12 文件，80/80；包含阶段 1～5、旧 Git-first、权限和安全回归。
- 普通测试：4 文件、16 项通过；9 个数据库文件、71 项在无测试 URL 时安全跳过，数据库
  路径已由完整 CMS 回归覆盖。
- `npm run v2:phase0:audit`：260 个 Markdown 基线通过。
- `npm run wiki:check`：226 个 Wiki 文件通过。
- `npm run typecheck`、`npm run build`、基础/回滚 Compose config、脚本语法和
  `git diff --check` 通过。
- 构建处理 4 个集合/260 个内容文件；既有静态图片解析 warning 和 Nuxt timing
  warning 不阻断，退出码为 0。

专项失败注入证明 Revision、current pointer、草稿、发布记录、审计和 Outbox 同成
同败；并发仅一个请求成功且序号连续；无效 Git 远端下成功；提交后数据库前台立即返回
新 Revision；缓存只失效目标文章；历史/Diff/恢复/删除/恢复删除与一致性报告均通过。

### 已知限制

- 阶段 6 Worker 未实现，pending Outbox 不会自动导出，最近导出状态只是安全占位。
- 缓存仍是单进程有界缓存；多实例广播尚未实现。Revision UUID 键保证新 current
  Revision 不复用旧缓存，删除/恢复依靠本实例精确失效。
- 成员仍为 legacy 权威；Nuxt Content、旧 Git-first 和仓库 Markdown 继续保留。
- Git-first 回滚期间产生的 Git-only 内容不会自动反向覆盖数据库；再次切回 DB-first
  前必须冻结发布并人工回填/对账。
- 尚未执行浏览器人工验收、真实预发布或生产部署，也没有声称 Outbox 已导出。

### 人工验收、清理与 Commit

- 浏览器优先启动、发布、无效 Git、等待导出、多人旧基线、历史/Diff/恢复、删除/恢复、
  Git-first 回滚、失败证据和精确清理见
  `docs/v2/PHASE_V2_5_ACCEPTANCE.md`。
- 人工脚本只创建明确带 phase5/manual-test 的本机容器、数据库、临时目录、隔离 bare
  Git 和 HTTP；不会使用 GitHub Token 或真实内容仓库。
- 自动测试容器在最终提交前按名称和归属标签精确删除，无测试 HTTP/Git 进程遗留。
- 本阶段独立 Commit SHA 由最终回复报告；未 Push、未部署、未进入阶段 6。

---

## 2026-07-30：阶段 5 人工验收修复——可视化图片 alt 无损往返

- 维护者首次执行阶段 5 浏览器验收时，在 Revision #1/#2 Diff 中发现多张独立
  Markdown 图片的中文 alt 文本被改为 `1.00`。只读数据库核对确认这是真实 Revision
  内容变化，不是 Diff 显示问题；图片 URL 未变化。
- 根因是 Crepe 7.21.3 默认 `ImageBlock` 明确把独立图片 alt 解析为数值 ratio，并在
  Markdown 序列化时输出两位小数。该编辑器行为早于 V2 阶段 5；DB-first 事务正确但
  忠实地发布了已被可视化编辑器改写的草稿。
- 修复禁用 `ImageBlock`，保留标准 CommonMark 图片节点和可访问 alt；现有可视化
  “无损往返检查”改为 fail closed，检测到实质差异时恢复原文并退回源码模式。
- 第一次修复后的人工重试被块间冗余空行合并误报为有损；比较逻辑进一步改为对
  Markdown AST 去除源码位置后做语义指纹比较。等价空行/标记格式允许通过，alt、
  链接、正文和代码块内容等节点变化仍 fail closed。
- 新回归覆盖中文独立图片 alt、块间冗余空行允许边界、`1.00` 与代码块空行丢失拒绝
  边界。本机无头 Chrome 使用真实 Crepe 对完整测试文章往返，语义判定通过且输出保留
  全部中文 alt。
- 验证结果：定向 2 文件 11/11；完整 CMS 回归 12 文件 81/81；`npm run typecheck`、
  `npm run build` 和 `git diff --check` 通过。构建只有既有静态图片与 chunk/timing
  warning。
- 自动回归使用独立容器 `vinci-v2-phase5-fix-test-db` /
  `vinci_v2_phase5_fix_test`，不复用人工验收库；验证后按归属标签精确清理。
- 空行误报修复再次使用独立容器 `vinci-v2-phase5-fix2-test-db` /
  `vinci_v2_phase5_fix2_test`：完整 CMS 12 文件 81/81、类型检查和生产构建通过，
  容器在核对归属标签后精确删除。
- 首次失败人工库在取证期间保留；修复提交后将精确重建干净人工库并从 Revision #1
  重新验收。阶段 5 人工项和总体完成项保持未勾选。
- 没有修改 `content/`、Migration、数据库 Schema、发布事务或依赖；没有接触生产、
  真实 GitHub/内容仓库、Push、部署或阶段 6。

---

## 2026-07-30：阶段 5 维护者人工验收通过

- 维护者确认原文：`V2 阶段 5 验收通过。`
- 修复后从干净 Revision #1 重建隔离人工环境；维护者重新完成 DB-first 发布和立即
  刷新、无效 Git 远端、当前 Revision/等待导出、多人旧基线冲突、历史/Diff/恢复、
  删除/恢复删除以及 Git-first 回滚和切回数据库，并确认浏览器测试全部通过。
- 可视化编辑器不再把中文图片 alt 改为 `1.00`，完整文章的 Markdown 语义往返保护
  正常；块间等价空行整理不会误报，实质内容变化仍 fail closed。
- 最终只读一致性检查统计 228 篇文章、231 个 Revision、3 次数据库操作、4 个 Outbox
  job 和 2 个删除事件，`issueCount: 0`、`issues: []`。
- 回滚时配置核对为 `disabled` 且 news/wiki/members 均为 `legacy_git`；切回后为
  `production`、news/wiki=`database`、members=`legacy_git`，应用和数据库健康。
- 最终确认代码仓库 `content/` 无改动。人工脚本核对归属标记后精确删除
  `vinci-v2-phase5-manual-test-db`、`/tmp/vinci-v2-phase5-manual-test` 并停止
  34160；`status` 和独立复查均确认无人工测试资源残留。
- 阶段 5 人工验收项和总体进度已全部勾选，允许在新的独立任务中开始阶段 6。
- 阶段 5 实现 Commit 为 `86c034cb91231053affcf860765540d3ced50c8b`，人工发现修复
  Commit 为 `a523cbb` 和 `8bf1067`；验收记录 Commit 由最终回复报告。
- 没有 Push、部署、生产资源访问、真实 GitHub/内容仓库写入、Outbox 导出或阶段 6
  实施。

---

## 2026-07-30：V2 阶段 6 实现与自动验证完成，等待维护者人工验收

### 范围与结果

- 实现数据库到唯一正式内容仓库
  `SDUTVINCI/sdutvinci_content:main` 的单向异步增量导出；没有写真实仓库。
- Migration `0014_tranquil_magdalene.sql` 新增 `content_export_runs`，并给阶段 5
  Outbox 增加目标/旧路径、预期哈希、租约、运行关联和实际导出结果；全部为
  expand-only，新列可空，旧槽位写法保留。
- 确定性 serializer 写稳定 `vinciId`、固定 frontmatter/嵌套键顺序、LF 和单一末尾
  换行；生成 version 1 的 `.vinci/snapshot.json` 与根 `manifest.json`。
- Worker 使用 PostgreSQL advisory lock、`SKIP LOCKED` 批量领取、租约回收、指数
  退避、最大重试、批量普通 Commit、远端 base/SHA 验证和非强制 Push；失败只补偿带
  精确归属标记的独立 workspace，不回滚数据库 Revision。
- 过期租约会同时关闭遗留 processing run；手动重试保留旧尝试数到审计并重置新一轮
  预算。CMS 文章详情显示状态/尝试/下次时间/脱敏错误，管理员重试接口要求权限、同源、
  CSRF 并写审计。
- 增量前验证 snapshot/manifest 和未受影响文件；配置拒绝非官方仓库、非 `main`、
  内嵌凭据、重叠 workspace、符号链接和越界路径。正式 enabled 要求独立 SSH key 与
  known_hosts；测试远端只在 `NODE_ENV=test` 显式开放。
- Compose 增加独立 operations Worker、backend-only 网络、独立 named volume 和显式
  凭据 overlay；基础 DB-first 应用仍不挂载内容仓库写凭据。

### 首次复制只读盘点

- 通过公开 HTTPS 对真实内容仓库重复执行两次只读 dry-run，远端始终为
  `7636bca74a1591f78f7268927cbfa8ab677b24bb`，branch `main`、clean、260 个 tracked
  files。
- 明确隔离数据库从代码仓库现有 `content/` 回填 228 篇新闻/Wiki；报告为 228 个
  `move_and_update`、32 个 `content/members/**` preserved、0 conflict。
- 228 个旧文件全部与隔离数据库原 Revision 字节一致；拟导出哈希变化只来自目录移动、
  `vinciId` 和确定性 frontmatter。两次报告完全一致，SHA 为
  `376c61414b6e7f8f8da703a48d28d7201eff94106a68bfaa3b6bbd5702fd68f4`。
- 该报告不是生产数据库报告，也不是接管授权。真实接管前必须用当时生产数据库重新
  dry-run，由维护者核对新 base/report SHA 并明确提供确认令牌。

### 自动验证

- 阶段 6 专项：1 文件，9/9；覆盖 dry-run 零变更/重复、确认接管、advisory lock、
  新增/修改/移动/删除、批量幂等、Push 拒绝与补偿、退避/上限/恢复、过期租约、人工
  重试、错误遮盖、serializer/config/path 和一致性。
- 完整 CMS 回归：13 文件，90/90。
- 普通测试：4 文件、17 项通过；10 个数据库文件、80 项在无测试 URL 时安全跳过，
  数据库路径由完整 CMS 回归覆盖。
- Phase 0 基线 260 个 Markdown、Wiki 226 个文件通过。
- `npm run typecheck`、`npm run build`、基础/内容导出 Compose config、全部 shell
  脚本语法和 `git diff --check` 通过。构建只有既有静态图片和 timing warning。
- 隔离人工脚本冒烟完成 260 文件测试仓库的逐项接管：2 news、226 wiki、32 preserved
  members、0 code workflow、snapshot/manifest 228 项、`issueCount: 0`；故障钩子恢复
  后精确清理。

### 资源、边界与下一步

- 自动数据库只使用 `vinci-v2-phase6-test-db`、`55447` 及两个名称含 test 的数据库；
  测试使用 `mkdtemp` 本地裸远端/工作区。人工冒烟只使用 `55448`、`34161` 和
  `/tmp/vinci-v2-phase6-manual-test`。
- 最终按容器标签和临时根归属标记精确清理。`55447`、`55448`、`34161`、dry-run
  clone 和阶段 6 临时根均无残留；仅保留任务开始前已有的 `vinci-cms-postgres`。
- 代码仓库 `content/` 无任何修改。没有生产数据库、真实写凭据、真实内容仓库写入、
  Force Push、代码 Push、部署或阶段 7 实现。
- 完整权限、接管、回滚、失败取证和一次性浏览器步骤见
  `docs/v2/PHASE_V2_6_ACCEPTANCE.md`；维护者人工验收清单与总体阶段 6 进度保持未勾选。
- 阶段 6 独立 Commit SHA 由最终回复报告；完成自动验证后停止，等待维护者人工验收。

---

## 2026-07-30：阶段 6 首轮人工验收发现导出 Commit 未显示并完成修复

- 维护者在隔离环境发布新闻版本 6，截图确认数据库发布立即成功、前台正文包含
  “阶段 6 单篇导出”。
- 截图中的 64 位值是内容“基线 SHA-256”，不是要求的 40 位内容仓库 Commit。只读
  `status` 同时确认应用和数据库正常、Worker 尚未运行。
- 进一步核对发现文章接口已返回 `latestExportedCommitHash`，但详情模板没有渲染。
  验收立即停止，没有勾选人工项或把基线哈希误判为导出成功。
- 详情页已增加“内容仓库 Commit”字段，仅在最近一次成功导出存在时显示。修复后重新
  通过 `npm run typecheck`、完整 CMS 回归 13 文件 90/90 和 `npm run build`。
- 旧人工环境及复验数据库均按名称、标签和归属标记精确清理；没有修改 `content/`、
  Push、部署、真实仓库写入或阶段 7 工作。
- 下一步重新创建隔离人工环境，执行 dry-run/确认接管并启动 Worker，再由维护者确认
  40 位 Commit、批量导出、失败隔离与手动重试。人工验收仍未通过。

---

## 2026-07-30：阶段 6 第二轮单篇导出通过并修正成功状态调度提示

- 维护者确认新闻 Revision #2 审核发布和前台正文立即生效；详情显示同步状态及
  `8926e2b4a34ae28db080ef3423f5f4dfd1dda1c4`。
- 只读仓库核对确认远端 HEAD 与页面一致，Commit 只修改目标 Markdown、
  `.vinci/snapshot.json` 和 `manifest.json`；一致性 `issueCount: 0`。
- 截图同时显示成功任务仍带已经过去的“下次”时间。数据库只读查询确认任务为
  `succeeded`，该值只是领取前的初始调度时间；继续展示会误导维护者。
- CMS 状态服务已改为仅对 `pending` 任务返回 `currentJobNextAttemptAt`，并补充成功
  状态为 `null`、Commit 匹配 Worker 结果的专项断言。
- 修复后阶段 6 专项 9/9、完整 CMS 13 文件 90/90、typecheck 和 build 通过。独立
  复验数据库已精确清理；人工数据库、管理员、测试内容仓库和 Worker 原地保留。
- 维护者仍需刷新确认提示消失，然后继续多篇批量、远端拒绝、数据库不回滚和手动重试。
  人工清单和阶段总体项仍未勾选。

---

## 2026-07-30：阶段 6 故障验收保留提前重试证据并收紧 CMS 错误摘要

- 两个不同文章任务同批导出成功，共享
  `52e8006a6efebbb346653bfacf6ae1600d3203c9`，Commit 信息为
  `content: export 2 database changes`，一致性 `issueCount: 0`。
- 隔离远端拒绝 Push 后，Revision #4 和前台正文立即生效；任务两次失败，数据库未
  回滚，远端保持旧成功 Commit。
- 维护者在修复远端前提前点击手动重试。系统记录一条 `content_export.retry`，保留
  `previousAttemptCount: 2`；新预算再次尝试两次后安全回到 `failed`。这不写真实
  仓库，也未破坏测试状态。
- 截图发现 CMS 虽遮盖远端 URL，仍回显 Git 命令和远端 stderr。运行/job 记录继续
  保留已脱敏运维详情，CMS 改为按错误码输出固定安全摘要，拒绝把存储错误返回浏览器。
- 新增断言验证 `CONTENT_EXPORT_GIT_FAILED` 安全摘要不含 `git push` 或
  `pre-receive`。阶段 6 专项 9/9、完整 CMS 90/90、typecheck 和 build 通过。
- 人工应用原地重启后 failed/2、重试审计、管理员、测试远端与 Worker 均保留。下一步
  刷新确认摘要，修复隔离远端，再执行一次手动重试并核对最终一致性。人工项仍未勾选。

---

## 2026-07-30：V2 阶段 6 人工验收通过并正式收尾

- 维护者确认修复后的安全错误摘要不再显示 Git 命令、远端 stderr、URL、凭据或绝对
  路径；随后隔离拒绝钩子按精确归属标记移除。
- 最终手动重试新一轮尝试 1 次成功，job 与远端 HEAD 均为
  `7cc16a05caca1a0619116d6256e43b1a33e55e42`。数据库 Revision #4 和前台正文在整个
  故障窗口未回滚。
- 两条 `content_export.retry` 审计均保留 `previousAttemptCount: 2`，覆盖维护者在
  远端仍拒绝时的提前重试和远端修复后的最终重试。
- 最终 Markdown 含稳定 `vinciId: ba859e42-1048-48bd-879e-9a5f32ec2292`、单篇/
  批量/故障测试正文；snapshot 指向 Revision
  `34c058d5-34b3-4c9b-990d-85df403b2bab`（#4）。
- snapshot 与 manifest 中目标文件 SHA-256 同为
  `c0aded2177f7663d3bb6d5334d587141c4de01ba6f4c469ac7a31705f37994e0`；
  2 news、226 wiki、32 members preserved、0 code workflow，最终 `issueCount: 0`。
- 维护者明确回复“V2 阶段 6 验收通过”。验收清单和总体阶段 6 进度已据此勾选；真实
  生产接管、真实细粒度写凭据等未执行部署门禁保持未勾选。
- 人工数据库、应用、Worker、本地裸远端、独立 workspace、日志及
  `/tmp/vinci-v2-phase6-manual-test` 已按容器标签、PID 命令和归属标记精确清理；
  `55447`、`55448`、`34161` 均无监听。
- 阶段 6 实现/修复 Commit 为 `d3528bf`、`a535ce2`、`18baf8a`、`09369b3`；验收
  记录 Commit 由最终回复报告。没有 Push、部署、真实内容仓库写入或阶段 7 实施。

---

## 2026-07-30：V2 阶段 7——凌晨 3 点全量对账、初始化和灾难恢复

### 完成状态

- 实现：完成。
- 自动化验证：完成并通过。
- 人工验收：等待维护者，不勾选阶段 7 人工项或总体完成项。
- 下一阶段是否开始：否；不得进入阶段 8。

### 修改内容

- 增加 `Asia/Shanghai` 03:00 全量数据库到内容仓库对账，与阶段 6 Worker 共用
  advisory lock；无差异不 Commit，有差异生成普通非强制修正 Commit。
- 对账生成完整临时快照、snapshot/manifest 和带双方 SHA-256、差异分类、base/result
  Commit、report hash 的脱敏报告；CMS 工作台显示最近时间和安全结果。
- 增加全部业务表严格空库 initialize dry-run、精确确认令牌、格式/ID/路径/哈希/引用、
  manifest 外受管文件及 active/tombstone 冲突校验、单事务导入/审计，以及与未来普通
  PR 导入完全分离的 disaster recovery CLI/profile。
- 增加 V2 PostgreSQL/配置状态清单备份、互斥、重试、完整性校验、最近成功状态、
  JSONL 告警、磁盘保护、分层保留和带归属标记的安全清理。
- 增加 snapshot 恢复后的向前 Migration、pointer/hash 完整性与本机健康检查流程。

### 数据库和接口

- expand-only Migration `0015_chubby_scorpion.sql` 新增
  `content_reconciliation_runs`、`content_import_runs`、`content_import_items`；
  无删除、重命名或收紧旧列。
- 既有 CMS dashboard 响应增加 `reconciliation` 安全摘要；没有浏览器恢复写 API。
- 普通应用启动没有自动导入钩子，非空数据库没有 override。

### 配置、调度和权限

- `.env.example` 记录对账根、恢复禁用态、备份重试/磁盘阈值、三层备份与三类对账资产
  保留期限；运维包装脚本从 Compose 环境读取这些值。
- 项目内 systemd timer 定义 02:00 备份、03:00 对账、04:00 cleanup，均为
  `Asia/Shanghai`；本阶段未安装或修改宿主机 timer。
- 恢复使用独立 operations profile、只读 source mount 和一次性确认变量；没有复用 CMS
  或未来 PR 导入权限。

### 测试与构建

- 阶段 7 专项：数据库/Git 5/5 和运维安全 shell 通过，覆盖 no-op、篡改/缺失/新增/
  多余、metadata、互斥、空库/非空、错误格式/哈希/令牌、事务回滚、分层保留、失败门禁、
  latest/verified/locked、过期资产、磁盘、根路径、symlink 和错误 UID。
- 完整 CMS：14 文件 95/95；普通测试：4 文件 17/17，另 11 文件 85 项在无数据库的
  普通模式按设计跳过。
- 真实 custom dump 隔离演练通过：checksum、两次失败后第三次成功、空库 restore、
  后置 Migration、应用健康、可恢复标记和非空拒绝。
- phase 0 内容审计通过：260 Markdown、0 symlink，字节清单 SHA-256
  `db36a4ef8c696d95662d5e1cac6c5fd5792ae02610ed6e5aab36d25ef1fe5ede`；
  Wiki 226 文件通过。
- typecheck、build、基础/reconcile/recovery Compose config、全部 shell syntax、
  systemd syntax/calendar、`git diff --check` 通过；两种 npm audit 均为 0。
- 最终自动验证曾发现运维 fixture 把月度应保留备份误当过期；已保留轨迹、改为真实
  过期 fixture，并以标签化瞬时容器动态验证错误 UID 后重跑上述专项、CMS、typecheck
  和 build。

### 安全和生产资源边界

- 仅使用 `vinci-v2-phase7-test-db`、名称含 test 的数据库、动态隔离 Compose project、
  本地裸 Git 远端、独立 workspace/backup/snapshot/report/tmp 和回环端口。
- 没有使用生产数据库、生产 Git 凭据、真实内容仓库写权限、真实备份存储或部署环境；
  没有 Push、Force Push、部署、真实 GitHub 写操作或宿主机 timer 安装。
- 代码仓库 260 个 `content/` Markdown 字节清单保持不变。

### 已知限制和回滚

- Markdown snapshot 不包含用户、草稿、审核、会话、完整 Revision/审计历史或 S3
  二进制，正常迁移仍必须使用 PostgreSQL dump 和独立对象存储备份。
- 配置备份只记录 set/missing 和示例键，不保存密钥值；可恢复标记必须来自真实隔离演练。
- 阶段 8 普通 PR 修改导入尚未实现。
- 回滚时停用三个新 timer/profile 并保留 run/report/backup，再普通
  `git revert <阶段7实现Commit>`；保留 expand-only `0015` 表，不 down Migration，
  不 reset/force 内容仓库，不删除旧 `content/`。

### 人工验收

完整的一次性浏览器优先步骤、预期结果和异常证据见
`docs/v2/PHASE_V2_7_ACCEPTANCE.md` 第 14 节。维护者无需真实 GitHub 写权限；Codex
准备和清理隔离数据库、本地远端、应用、故障注入、恢复根、日志、端口及确认令牌。

### Commit

- 阶段 7 独立本地 Commit 由最终回复报告。
- 未 Push、未部署、未进入阶段 8；等待维护者人工验收。

---

## 2026-08-01：V2 阶段 7 人工验收通过并正式收尾

- 维护者依次确认初始状态、无差异对账、四类差异修正、互斥跳过、锁释放后重跑、
  空库初始化、灾难恢复、运维状态与最终工作台均正常，并明确回复
  “V2 阶段 7 验收通过”。
- 无差异对账保持本地测试远端 HEAD
  `d26b4fa00fce6d11c119197a152aebfd251a1260`；数据库新增、仓库缺失、修改及多余文件
  由普通非强制修正 Commit `79da63982905efa5256989ac00f0ba3da098e36f` 一次纠正。
- 阶段 6 Worker 共用锁占用时对账以 busy/exit 75 跳过且不写远端；释放后无差异重跑
  成功，HEAD 继续保持修正 Commit。
- initialize 与 disaster recovery 分别使用独立空测试数据库和 mode 绑定确认令牌；错误
  令牌、跨 mode 令牌、非空库及事务故障注入均 fail closed，故障后无半导入数据。
  两次正确恢复均导入 229 篇文章和 32 名成员，后置 Migration、pointer/hash 完整性和
  应用健康检查通过。
- 运维复验覆盖 Shanghai 02:00/03:00/04:00 调度、备份互斥与失败重试、custom dump
  完整性、状态/告警、分层保留 Dry Run、失败备份门禁、latest/verified/locked 保护、
  过期资产、磁盘阈值、路径越界、符号链接和错误归属拒绝。
- 页面验收期间发现隔离应用误设 production 不允许的 `CONTENT_SOURCE_MEMBERS=database`；
  当时数据库与 API 正常，改回 `legacy_git` 后页面正常，判定为人工测试环境配置而非
  产品缺陷，因此没有验收修复代码 Commit。
- 人工数据库、容器、本地裸 Git 远端、workspace、日志、备份/快照/报告/临时目录及
  `55450`、`34162`、`34163` 端口均按名称、标签和归属标记精确清理；既有
  `vinci-cms-postgres` 保持运行，代码仓库 `content/` 未修改。
- 阶段 7 实现 Commit 为 `45f4a5934d4dac9bfeb55ff406fed016d714b97b`；验收记录 Commit
  由最终回复报告。没有 Push、部署、真实 GitHub/内容仓库写操作、宿主机 timer 安装或
  阶段 8 实施。

---

## 2026-08-01：V2 阶段 8 实现和自动验证完成，等待人工验收

### 基线和范围

- 开始前 `main` 为 `dc3ed17a08dad34bec9f3be56dde24bda21c986c`，工作树干净，
  `origin/main...HEAD` 为 behind 0 / ahead 7；用户列出的 7 个本地提交逐个核对并完整
  保留，没有 reset、rebase、覆盖或改写。
- 阶段 7 验收记录、架构、部署、需求和阶段 6/7 数据/导出/snapshot/recovery/CMS 安全
  代码已完整阅读。内容仓库只读记录 HEAD 仍按交接基线
  `7636bca74a1591f78f7268927cbfa8ab677b24bb`；本阶段没有访问真实远端写权限。
- 只实现阶段 8 新闻/Wiki PR 导入；没有成员数据库权威、成员 PR 导入、Push、部署、
  Force Push、Merge 或阶段 9 工作。代码仓库既有 `content/` Markdown 未修改。

### 数据、服务和权限

- expand-only `0016_flowery_war_machine.sql` 新增 `content_pr_import_runs/items`、
  `content_pr_external_actions`、`article_redirects`、草稿 proposal 列和
  `content_importer` 角色；旧草稿默认普通 edit，旧应用可忽略新对象。
- CMS 新增 `/cms/content-imports` 与六个 API。管理员或明确授予的
  `content_importer` 才能访问；服务端角色、同源、CSRF、官方仓库/PR/Base main/
  open/Commit 校验均 fail closed。普通导入与阶段 7 recovery 表、CLI、profile 和确认
  令牌没有调用关系，不能全量覆盖非空库。
- GitHub client 只读取分页 PR Diff 和 Base/Head commit-bound contents；拒绝 symlink、
  非 file、超大、二进制、非法编码/base64，并重试网络/429/5xx。评论和关闭是独立确认
  动作，关闭额外要求 admin；代码中没有 Merge API。
- Dry Run 验证 `.vinci/snapshot.json`、hash/bytes/path/UUID/Revision/vinciId，确定性生成
  Current，逐文件持久化 Base/Current/Proposed/Merged 和哈希。十类结果覆盖安全、自动
  合并、冲突、新增、移动/重命名、删除提案、路径冲突、非法、未知和高风险语法。
- 三方合并把 edit 扩展到段落：不同段落自动合并，同段不同 edit 阻止。导入 item 和
  Article 在事务内锁定并复核 Current Revision；发布仍使用现有 baseRevision 冲突门禁，
  不会静默覆盖数据库新版本。
- 只选择安全子集即可创建普通 draft/proposal；同 PR/Head run 唯一，item 重试返回同一
  draft。新增文章由 DB item 预分配正式 UUID/目标路径，移动保持 vinciId 并在批准发布后
  建 redirect，删除只在批准发布后生效。导入不批准、不发布、不写正式 Revision。

### 安全、审计和文档

- 受管路径只允许 NFC `news/**/*.md`/`wiki/**/*.md`；拒绝 traversal、绝对/反斜线/NUL、
  `.git`、members/metadata、manifest 外、跨 collection/目录移动、重复路径/ID 和路径
  占用。HTML、Vue/MDC、可执行标签/属性/URL和未知模板突出且不可导入。
- run/item/外部 action 和 audit 覆盖 Dry Run、逐项/批次导入、评论、关闭和失败；CMS
  artifact 使用敏感值替换。Token、Authorization、数据库 URL、私钥、远端 URL和绝对
  路径不进入响应/审计摘要。
- 新增 `docs/v2/PR_IMPORT.md` 与 `docs/v2/PHASE_V2_8_ACCEPTANCE.md`；架构、部署、需求、
  Compose 和 env 示例已更新。人工清单仍全部未勾选，阶段 8 总进度也未勾选。

### 自动验证和问题修复

- 阶段 8 专项 10/10；完整 CMS 15 files 105/105；无数据库普通模式 4 files 17/17，
  另 12 files 95 项按设计跳过。专项使用名称含 test 的独立 PostgreSQL、临时裸 Git 和
  fake GitHub，覆盖合并/冲突/竞态/部分导入/幂等/提案后人工发布/redirect/恶意文件/
  权限/分页/重试/失败/评论/关闭/脱敏，没有真实 GitHub 写入。
- 浏览器夹具首次发现 Nitro 把直接 `process.env.NODE_ENV` 固化为 build-time production，
  导致明确 test 运行时的 mock 被拒绝；当时 500 日志和零 run/draft 已核对。改为运行时
  `Reflect.get` 守卫后重建，7 文件正确分类为 5 importable/2 blocked；smoke 数据随后清空。
- typecheck、production build、0000→0016 fresh Migration、no-change generate、Compose、
  全部 shell syntax、wiki、diff check 和 content 字节清单最终均通过。最终 CMS 重跑曾因
  手工使用错误测试库账号在认证阶段退出；改用容器实际隔离账号后为 15 files 105/105，
  没有把测试命令参数错误判作产品通过。

### 人工验收环境和回滚

- 当前保留三个带 `com.sdutvinci.scope=v2-phase8-manual-test` 标签的容器、回环
  `55452/34162/34163`、本地裸 Git、PR #8 fixture 和 mock API。CMS 为
  `http://127.0.0.1:34162/cms/login`，账号 `phase8admin`，测试密码见阶段 8 验收文档。
  当前是 0 run、0 item、0 draft、9 初始 Revision、0 external action 的干净人工状态。
- 一次性浏览器步骤、预期和异常证据见 `docs/v2/PHASE_V2_8_ACCEPTANCE.md` 第 5 节；不需要
  真实 GitHub Token。评论/关闭只改本地 mock，关闭放在最后。
- 若异常，保留容器/DB/Git fixture/log/action 后修复并重跑受影响专项、完整 CMS、
  typecheck/build。人工完成后先 `npm run v2:phase8:manual -- inspect`，再 `stop` 逐标签和
  marker 精确清理。
- 应用回滚只用普通向前 `git revert <阶段8实现Commit>`；保留 `0016` 新表/列和 audit，
  不 down migration。已发布提案使用既有 Revision restore/删除恢复，不删除 PR run 来
  回滚正式内容。

### Commit 和下一步

- 阶段 8 独立本地 Commit 由最终回复报告完整 SHA。
- 未 Push、未部署、未自动 Merge；现在停止开发，等待维护者明确人工验收，不进入阶段 9。

---

## 2026-08-01：阶段 8 人工验收前四方材料中文标签修正

- 维护者反馈 `baseSource` 等字段名不易理解。CMS 现显示
  `Base Source（PR 分支起点内容）`、`Current Source（数据库当前正式内容）`、
  `Proposed Source（PR 提议的新内容）`、`Merge Result（三方合并后的草稿候选）`；页面
  摘要、说明和查看按钮中的 Base、Head、Diff 也补充中文解释，英文仍保留以对应审计字段。
- 新增静态 UI 断言；阶段 8 专项 10/10、完整 CMS 15 files 105/105、typecheck、wiki check
  和 production build 均通过。独立测试数据库已按名称和标签精确清理，没有真实 GitHub
  请求或写操作，代码仓库 `content/` 未修改。
- 最终构建已重启到原人工验收容器。维护者此前已执行一次 Dry Run，当前只读状态为
  1 run、7 items、0 drafts、9 正式 Revision、0 external action；保留该进度，不重置。
- 本次使用新的本地修正 Commit，不 amend、不改写阶段 8 实现 Commit；未 Push、未部署、
  未进入阶段 9，继续等待维护者人工验收。

---

## 2026-08-01：阶段 8 三方审计材料改为文件卡片内联展开

- 维护者要求查看材料后不要跳到页面底部。现在点击某个 Diff 文件的查看按钮，会把四方
  材料直接展开在该按钮下方；再次点击同一按钮或点击“关闭”均原地收起。切换到另一文件
  时只展开新文件的材料，并用 `aria-expanded`/`aria-controls` 表达可访问状态。
- 静态 UI 回归增加内联定位和收起文案断言；阶段 8 专项 10/10、完整 CMS 15 files
  105/105、typecheck、wiki check 和 production build 均通过。独立自动测试数据库已按
  名称和标签清理，`content/` 未修改。
- 最终构建已重启到人工验收容器；1 run、7 items、0 drafts、9 正式 Revision、0 external
  action 的现有验收进度保持不变。本次另建本地修正 Commit，不 amend、不 Push、不部署、
  不进入阶段 9。

---

## 2026-08-01：V2 阶段 8 人工验收通过并正式收尾

- 维护者完成完整浏览器流程并明确回复“V2 阶段 8 验收通过”。期间提出四方材料中文解释
  和文件卡片内联展示两项可用性意见，分别由本地 Commit
  `ee738bea0a2d07ed64191c14bb174853565e5da5`、
  `84f66b71e25199f6dee62fda9af71eb2d0d2980e` 修正，均重跑阶段 8 专项 10/10、完整 CMS
  105/105、typecheck 和 production build。
- 清理前 `npm run v2:phase8:manual -- inspect` 为 1 run、7 items、5 drafts、9 formal
  revisions、2 external actions。5 个安全项创建草稿/提案，2 个冲突/高风险项未导入；
  正式 Revision 数未增加。外部动作仅为脱敏本地 mock 评论和关闭，没有 Merge。
- 随后 `npm run v2:phase8:manual -- stop` 已按名称、标签和 marker 清理人工数据库、三个
  容器、本地裸 Git 远端、PR fixture、mock state、日志和临时目录；`55452/34162/34163`
  均释放。代码仓库 `content/` 未修改，没有真实 GitHub、生产数据库/凭据、Push 或部署。
- 需求文档 24.5 和阶段 8 总体进度已据维护者明确结论勾选；阶段 9～11 仍未开始。
  阶段 8 验收记录 Commit 由最终回复报告完整 SHA。现在停止开发，不进入阶段 9。

---

## 2026-08-01：V2 阶段 9 实现完成，等待人工验收

- 基线为阶段 8 验收记录 `a087ba8139622f875db1b1d4042f50920ed95a49`；开始时 `main`
  工作区干净。阶段 9 没有改写既有 Commit，没有 Push、部署、真实 GitHub 写入或阶段 10 工作。
- `members` 已扩展为结构化数据库投影并使用 version/current pointer；新增不可变
  `member_revisions` 和显式 `member_proposals`。CMS create/update/restore/apply proposal 均为
  DB-first 事务，写结构化 before/after audit 与 member Outbox。账号绑定仍独立使用
  `user_members`，不会进入公开资料或 Markdown。
- 显式迁移命令 `v2:members:migrate` 默认 Dry Run，Apply 必须提供
  `--apply --confirm=MIGRATE_MEMBER_PROFILES`。它扫描 32 份既有文件、验证稳定 ID/字段/URL、
  保留已有 member UUID，并只为无 current pointer 的成员建立初始 Revision；重复运行幂等。
  普通 list/get、应用启动和 `cms:content:sync` 不再同步成员 Markdown。
- 公开团队列表与详情完全读取 PostgreSQL。production 成员默认 `database`；
  `CONTENT_SOURCE_MEMBERS=legacy_git` 仍是验收期显式读取回滚开关。代码仓库成员文件未改动。
- 成员确定性 serializer 已接入内容仓库 `members/`、snapshot/manifest、增量 Worker、takeover、
  一致性、凌晨对账和空库恢复。恢复使用 snapshot 中的 member/revision UUID、字节与 SHA，
  不降级为缺少历史指针的稀疏 member 行。
- PR Dry Run 现支持成员安全修改、字段级自动合并、冲突、敏感拒绝和删除提案。导入只创建
  `member_proposals`；管理员在成员页再次明确接受并通过 version/pointer 复核后才创建正式
  Revision。账号、密码、绑定、系统角色权限、安全状态、内网 URL、稳定 ID/路径变化均拒绝；
  敏感 Proposed 原文不进入可查看 artifact。评论/关闭保持阶段 8 边界，没有 Merge API。
- Migration 为 expand-only `0017_pale_betty_ross.sql`。部署顺序、迁移/回滚、PR 分类和本地
  人工步骤分别记录在 `DEPLOYMENT.md`、`PR_IMPORT.md` 与
  `PHASE_V2_9_ACCEPTANCE.md`。`v2:phase9:manual` 可建立带精确 label/marker 的隔离 CMS，内置
  32 名成员、管理员、本地裸 Git 和 mock GitHub PR #9；PR 覆盖安全修改、字段自动合并、
  同字段冲突、敏感拒绝与删除提案，启动时不会预先创建正式提案。
- 维护者尚未回复“V2 阶段 9 验收通过”，所以总体进度仍未勾选。本地实现 Commit 由最终回复
  补充；专项 35/35、完整 CMS 108/108、完整测试 123/123、typecheck、build、0000→0017
  fresh Migration、content audit、wiki check 与 diff check 已通过。人工环境另提供 34174
  legacy Git 只读回退站点；现在应停止开发并等待人工验收，不进入阶段 10。

---

## 2026-08-02：阶段 9 人工验收 legacy Git 回退站点修正

- 维护者在浏览器发现 34174 没有成员。现场保留并核对：34172 成员 API/列表/详情均为 200，
  34174 `/team` 外壳为 200，但 Nuxt Content 查询为 `SQLITE_CANTOPEN`，成员详情为 404。
  根因是回退容器只读挂载仓库，而 Node preset 把运行时 `contents.sqlite` 相对
  `.output/server/index.mjs` 解析到只读构建目录；原健康检查只检查 `/team` 状态码，未发现空列表。
- 34174 现在通过 `NITRO_CONTENT_DATABASE_FILENAME` 把运行时 SQLite 精确指向阶段 9 临时目录；
  源码和 `.output` 继续只读。回退启动检查必须从 `/team/wangziming` 实际读到“王子铭”。新增
  `restart-rollback` 只替换带正确 label 的回退容器，不重置 PostgreSQL、Revision、Outbox、
  本地内容仓库、PR fixture 或其他验收进度。
- 原地修复后 34172/34174 的 `/team` 和 `/team/wangziming` 均为 200，两边各渲染 32 个唯一
  成员链接，34174 不再记录 SQLite 错误。维护者已完成的在线修改与恢复得到保留：当前为
  32 members、36 revisions、36/36 member export jobs succeeded，仓库/snapshot 各 32，
  `repository_matches_database=yes`，PR run/item/proposal 仍为 0。
- 新的带 label 隔离 PostgreSQL 上重跑阶段 9 专项 35/35、完整 CMS 108/108、typecheck、
  wiki check 和 production build 均通过，测试库随后精确清理。修正使用新的本地 Commit，
  不 amend、不 Push、不部署、不进入阶段 10；继续等待维护者从回退检查处恢复人工验收。

---

## 2026-08-02：V2 阶段 9 人工验收通过并正式收尾

- 维护者完成浏览器流程并明确回复“V2 阶段 9 验收通过”。最终只读状态为 32 members、
  37 member revisions、1 PR run、5 PR items、2 pending proposals、37/37 member export jobs
  succeeded、0 bindings、32 repository member files、32 snapshot members，且
  `legacy_member_links=32`、`repository_matches_database=yes`。
- 3 个可导入项只创建成员提案；明确接受 `dongjiahui` 后才建立正式 Revision。`zouchangdi`
  和 `likun` 的提案仍 pending，删除未自动生效；冲突和敏感项未导入。维护者额外明确授权了
  1 条本地 mock PR 评论，PR 仍 open，没有关闭、Merge 或真实 GitHub 写入。
- 验收中发现并修复 34174 Nuxt Content 运行时 SQLite 只读路径问题；修复后数据库权威与
  legacy Git 页面各显示 32 名成员，相关专项/CMS/typecheck/build 已重跑通过。需求文档 25.5
  和阶段 9 总体进度已据维护者明确结论勾选。
- 阶段 9 人工数据库、五个容器、本地裸 Git、PR fixture、mock state、日志和临时目录将在本次
  验收记录 Commit 后按 label/marker 精确清理。没有 Push、部署、真实外部写入或阶段 10 工作。

---

## 2026-08-02：阶段 8 PR 导入页面可读性与 Diff 高亮修正

- 在阶段 9 验收后的干净 `main` 上实施；开始时 HEAD 为阶段 9 验收记录
  `4eec1709d20f82220adc3de409141bea4efc2c49`，相对本地 `origin/main` behind 0 / ahead 16。
  全部既有本地提交保持原样，没有 reset、rebase、amend、squash、覆盖或丢弃历史。
- PR 外部操作改为白话说明：“把检查结果留言到 PR”只发送脱敏数量摘要；“关闭这个 PR
  （仅管理员）”只关闭 PR。两者都明确说明不会 Merge、批准、发布或删除已创建的草稿/
  成员提案。确认框和成功消息同步改为同一语义。
- 外部动作记录不再直接显示 `comment · succeeded`。页面使用中文动作、中文状态、明显的
  ✓/!/… 图标、2px 状态边框和整块背景区分成功、失败、执行中，不只改变字体颜色。
- Base / Current / Proposed / Merge 使用白话标题和 Git diff 风格行视图：Base 为基准，
  Current/Proposed 与 Base 比，Merge 与 Current 比；显示旧/新行号、`+`/`-`、绿色新增
  整行、红色删除整行和无底色上下文。删除、冲突、新文章和敏感成员材料使用明确空状态。
- 新增独立共享行 diff helper 和真实增删/行号测试。服务端 GitHub 写入、权限、脱敏、
  三方合并、导入事务、成员资料数据库权威、Revision、Proposal、Outbox 和导出逻辑均未改。
- 自动验证：阶段 8 专项 13/13；阶段 9 专项 36/36；完整 CMS 109/109；typecheck、wiki
  226 文件、production build 和 `git diff --check` 通过。第一次 build 因源码相对路径无法
  被 Nitro 最终打包解析而失败，改用既有 Nuxt 根别名后重跑成功。
- 验证只使用带 `com.sdutvinci.scope=v2-pr-ui-test` 标签的临时 PostgreSQL 17 容器和名称
  含 `test` 的独立数据库；最终按精确名称和标签清理。没有真实 GitHub 请求、内容仓库写入、
  生产数据库/S3/服务器访问、Push、部署或阶段 10 工作。
- 本修正使用新的独立本地 Commit；SHA 由最终回复报告，不改写阶段 8、阶段 9 既有 Commit。

---

## 2026-08-02：V2 阶段 10 实现与自动验证完成，等待人工验收

- 从基线 `08a1c4908c8890dad5284e9682304e1ac0c7550e` 继续实施。接手时发现阶段 10 已执行到
  删除内容并修改代码/文档的中间状态；完整保留既有 Commit 和当时工作区，没有 reset、
  rebase、amend、squash 或覆盖。当前本地 `origin/main` 追踪引用也指向该基线；本轮没有
  fetch、Push、部署、真实 GitHub/S3/COS 写入或阶段 11 工作。
- 删除前 annotated tag 为 `v2-phase10-pre-removal-20260802-08a1c49`。带 marker 的恢复根
  `/tmp/vinci-v2-phase10-pre-removal-08a1c49` 保存 260 文件清单、tar、完整 Git bundle 和三次
  SHA 对照。稳定路径清单摘要为 `7aea323b...8656`；tar 为 `740ab40c...d402`，bundle 为
  `0bce06bc...f261`，bundle verify 与标签临时 worktree 回滚对照均通过。
- 代码仓库正式 `content/news`、`content/wiki`、`content/members` 共 260 个 Markdown 已删除；
  独立内容仓库仍为 2 news、226 wiki、32 members、snapshot 228 articles + 32 members、
  manifest 260，HEAD `33da6612aeff549cd15ba33b3866ffbcefacee90`。数据库、文件、snapshot
  和 manifest 全量一致性 `issueCount: 0`。
- Nuxt Content 模块、配置、hook、transformer、`queryCollection`/`ContentRenderer`、候选来源
  HTTP 配置及仅由其需要的依赖已移除。`@nuxt/content`、`better-sqlite3`、`@nuxtjs/mdc`
  不在安装树；Comark 所需 `shiki` 改为显式直接依赖。新闻、Wiki、成员、搜索、Sitemap 和
  RSS 固定从 PostgreSQL Current Revision 读取，动态正式内容固定 SSR。
- runtime 镜像只复制 Nitro `.output`，不含正式 Markdown、Git、SSH 或内容 workspace；
  operations 镜像继续承担 migration、导出、对账和受控恢复。Compose app 不再挂载代码仓库
  内容 worktree/凭据。代码、文档和配置变化统一分类 `application`，Actions/自动部署不再有
  纯 `content` 镜像通道；CMS 发布仍只写数据库 Revision/Outbox，由 Worker 更新独立内容仓库。
- Schema/Migration 无变化，继续为 0000～0017。删除公开 API
  `GET /api/v2/content/config`，三类公开内容 API 路径不变。退役
  `CONTENT_SOURCE_NEWS/WIKI/MEMBERS`、`CONTENT_CANDIDATE_ENV` 和旧 CMS Git worktree/SSH
  变量；内容导出、对账、PR 导入、S3/COS 和受控恢复变量保持。
- 从独立 snapshot 向两个名称含 `test` 的空库完成 mode 绑定 Dry Run/Apply，每库恢复
  228 articles、228 article revisions、32 members、32 member revisions。正常 PostgreSQL
  custom dump 的 checksum、空目标恢复、前向 migration、marker、应用健康、非空拒绝和隔离
  volume 演练也通过。snapshot 仍不能恢复账号、会话、草稿、完整审核/审计和全部历史，不能
  替代数据库完整备份。
- 自动验证：阶段 10 33/33、阶段 8 13/13、阶段 9 36/36、完整 CMS 109/109、完整测试
  131/131、typecheck、production build、fresh 18 migrations/no-change generate、Phase 0、
  Comark 260/260、Wiki 226/226、Compose 全 profile、所有 Shell 语法、部署/备份恢复集成、
  runtime 镜像检查、HTTP/SEO/feed/404、两类 npm audit 0 vulnerability 和 diff check 全通过。
  阶段 9 第一次未提供外部 snapshot 被前置检查按设计拒绝，补齐后全绿；build 刻意不提供
  snapshot 仍通过。
- 隔离站点继续在 `127.0.0.1:34175` 提供人工只读验收；阶段 9/10 数据库、本地内容仓库、
  PR mock、恢复库、回滚 tag 与恢复包暂不清理。详细浏览器步骤和异常取证模板见
  `docs/v2/PHASE_V2_10_ACCEPTANCE.md`。维护者尚未明确回复“V2 阶段 10 验收通过”，所以人工
  项、阶段总体完成项仍不勾选；本实现使用新的本地 Commit，完整 SHA 由最终回复报告，随后
  停止开发并等待人工验收。

---

## 2026-08-02：V2 阶段 10 人工验收通过并正式收尾

- 维护者执行压缩只读命令并完成浏览器检查，随后明确回复“V2 阶段 10 验收通过”。实现
  Commit 为 `88c059fcf4d686d543212117c46da9e1f83a0d88`；需求文档 26.6 和阶段 10 总体进度已
  据该明确结论勾选，阶段 11 仍未开始。
- 只读验收确认代码仓库无三类正式内容和 Nuxt Content 依赖，新闻/Wiki/成员、Feed、Sitemap、
  404 正常；runtime 镜像无 `/app/content`、Markdown、Git、SSH；删除前 annotated tag 指向
  `08a1c4908c8890dad5284e9682304e1ac0c7550e`，固定 content tree 为
  `c621880ed3e8d5f39335555c83ecedef834ffbe5`，包含 260 个文件。
- 维护者询问 `wiki-pinyin-path.ts` 删除原因。核对确认它只是依赖 `@nuxt/content` 的 29 行
  transformer 外壳；实际拼音路径、文档根和章节元数据仍由 `utils/wiki-content-meta.ts`、
  `utils/wiki-chapters.ts` 负责，`pinyin-pro` 仍为直接依赖，现有拼音 Wiki URL 返回 200。
- 验收准备中发现 34175 与隔离 PostgreSQL 已优雅停止，重启后恢复健康。34175 当时连接的是
  名称含 `test` 的内容 snapshot 恢复库，按设计没有用户，所以旧阶段 9 账号不能登录；创建
  隔离 `phase10admin` 后实际登录 API 成功。没有把账号写入产品或生产数据库。
- `/tmp` 下删除前 tar/bundle/SHA 恢复包在验收时已被系统临时目录清理；其原始 hash 和通过
  结果仍记录在阶段 10 验收文档，Git annotated tag 和完整仓库历史仍可恢复 260 文件。最终
  6 个带精确阶段 9/10 label 的容器和 1 个 runtime 检查镜像已删除，测试数据库不可恢复，
  回环端口释放；回滚 tag 保留。
- 本次只新增本地验收记录 Commit，不 amend、不 Push、不部署、不真实外部写入、不进入阶段 11。
  完整 SHA 由最终回复报告；现在停止开发。

---

## 2026-08-02：V2 阶段 11 实现与自动验证完成，等待最终人工验收

- 从阶段 10 验收记录 Commit `845ea6a96b9764c58b047722559e05e53616a320` 的干净 `main`
  开始；本地 `origin/main` 仍为 `08a1c4908c8890dad5284e9682304e1ac0c7550e`。本轮没有 fetch、
  Push、部署、reset、rebase、amend、squash 或历史改写，也没有进入其他新阶段。
- 新增唯一宿主运维入口 `./vinci`，覆盖当前用户 install/update/status/doctor、备份/校验/分层
  清理、空库恢复、实例导入导出、旧用户迁移、对账和维护。身份从 NSS 动态读取用户名、UID、
  GID、Home、Shell；root 直接运行、Home 根/仓库根/`/`、symlink、特殊文件、错误属主和非空恢复
  均 fail closed。旧用户迁移要求已验证备份和精确确认，不会自动 `userdel`。
- 生效 service/timer、logrotate、路径、脚本和现行文档已去除固定 `vinci-deploy` 身份；兼容安装
  脚本只转发新入口。unit 由 root 管配置、以当前用户运行，可在不同用户名、UID/GID/Home 的新机
  重新生成。新增每小时只读 health timer，并保留备份、自动部署、03:00 对账和维护调度。
- 备份和恢复继续复用既有 checksum、marker、空库门禁、`pg_restore`、向前 Migration 与健康检查。
  无密钥迁移包记录数据库备份、代码 bundle/Commit、镜像、slot、配置和内容/S3 清单；真实
  `.env`、Token、私钥和 S3 对象不进入包。分层保留为可配置的日/周/月，失败备份不触发删除，
  latest-success、verified、locked、活动镜像和 `.deploy/rollback-verified` 镜像均受保护。
- 新增只读 operations doctor，检查数据库 Revision 指针、内容导出、对账、PR 导入、S3/COS
  Bucket 与媒体对象、公开 URL、磁盘、Compose、gateway、活动槽和 timer；缺失对象仅输出 key
  哈希。未新增 HTTP API、npm 依赖或数据库 Migration，仍为 28 张表、0000～0017。
- 更新部署短流程、最终架构、备份恢复、PR 导入和完整运维教程；十份教程均包含前置条件、命令、
  预期/验证、失败处理、回滚和安全注意事项。V1/阶段 0 文档只新增历史基线提示，未删除或篡改。
  Wiki 拼音继续由 `utils/wiki-content-meta.ts` 和 `utils/wiki-chapters.ts` 承担；没有重新引入
  Nuxt Content 或正式 `content/`。
- 隔离自动验证全部通过：阶段 11 专项 12/12、Markdown/XSS 4/4、删除前 Wiki 226/226；fresh
  migration 后完整测试 132/132、CMS 109/109、阶段 10 回归 33/33；备份/空库恢复、非空拒绝、
  新旧服务器导入导出、S3 替身、真实本地镜像 blue→green、故障候选回滚、systemd/logrotate、
  不同 UID/GID/Home、分层保留、清理和自动部署均通过。typecheck、production build、Compose
  test 配置、全部 Shell 语法、`git diff --check` 通过；两类 npm audit 均为 0 vulnerability。
- 所有动态资源名称含 `test`，带精确 marker/label，数据库与凭据为 test 值，端口仅回环；本地
  bare remote 普通 Push 只服务于蓝绿测试。没有连接生产 PostgreSQL、生产 S3/COS、生产 Git、
  真实 GitHub 写接口或生产服务器，也没有保存/输出明文真实密钥。详细证据、已知限制、生产前
  清单和回滚方法见 `docs/v2/PHASE_V2_11_ACCEPTANCE.md`。
- 阶段 11 实现使用新的独立本地 Commit；完整 SHA 由交付回复报告。Codex 提交后在固定 test
  根准备隔离人工环境，维护者只需执行验收文档中的一个只读验证入口。27.5、最终人工项和
  V2.0 总体完成项保持未勾选；现在停止开发并等待完整确认语：
  “V2 阶段 11 验收通过，V2.0 最终验收通过”。
- 实现 Commit 为 `d240ba4b126c919649572663bc2a7e0418a5884b`。提交后准备隔离环境时发现
  Docker Compose v5 的 `ps --format json` 为逐行 JSON，而管理脚本的可选 `status` 展示按数组
  解析；产品、容器健康和 `verify` 不受影响。以新的独立验收准备修复 Commit 同时兼容数组和
  逐行格式，不 amend 实现 Commit；完整修复 SHA 由交付回复报告。

---

## 2026-08-02：V2 阶段 11 与 V2.0 最终验收通过并正式收尾

- 维护者以当前登录用户执行唯一人工命令 `./scripts/v2-phase11-manual-acceptance.sh verify`。
  动态 systemd Dry Run、status、doctor、备份与完整性校验通过；应用、PostgreSQL、gateway 和
  S3 替身均为 healthy，只使用 test 名称、精确 label/marker、测试凭据与回环端口。logrotate
  debug 提示和一次性 doctor 容器创建信息均为预期行为。
- 维护者随后明确回复原文：“V2 阶段 11 验收通过，V2.0 最终验收通过”。据此勾选 27.5、
  27.6 最后两项、阶段 11 总体项；阶段 0～11 总体进度现已全部勾选，V2.0 正式完成。
- 阶段 11 实现 Commit 为 `d240ba4b126c919649572663bc2a7e0418a5884b`，Compose v5 验收状态
  兼容修复 Commit 为 `e24d86ae35a816b879253e70f1d2800967da73fb`。本次另建独立本地最终
  验收记录 Commit，完整 SHA 由交付回复报告；不 amend、不 reset/rebase/squash。
- Codex 使用归属 marker 精确清理 `/tmp/vinci-phase11-manual-acceptance-test`、该 Compose
  project 的 test 容器、PostgreSQL volume、网络、gateway volume 和两张阶段 11 验收镜像；
  `127.0.0.1:48211/48212` 已释放。隔离测试数据库随 volume 删除且不可恢复，未删除任何生产
  数据；阶段 10 删除前 annotated tag 与 Git 历史继续保留。
- 收尾开始时只读复核发现本地 tracking ref `origin/main` 已指向
  `e24d86ae35a816b879253e70f1d2800967da73fb`，与上一轮交付时记录的 `08a1c49...` 不同；本次
  收尾没有 Fetch、Push、部署或调整该引用，也没有猜测其外部变化来源。
- 本次未访问生产 PostgreSQL、S3/COS、内容仓库、真实 GitHub 写接口或生产服务器，未输出真实
  密钥。最终验收记录提交后停止开发；任何生产 Push、部署或后续工作均须新的明确授权。

---

## 2026-08-02：V2 最终验收后 GitHub Actions 历史快照修复

- 最终验收记录 Commit 为 `ae263ea732e167aac88a80dc27c9e197de3c4b0a`。随后 GitHub Actions
  在 `npm run test:cms` 的 109 项中通过 107 项，两个历史全量用例因 runner 未设置
  `V2_CONTENT_SNAPSHOT_SOURCE` 在前置断言处失败；不是数据库、权限、Markdown 处理或产品
  运行时回归。现有 shallow checkout 还会令稍后的阶段 11 删除前 tag 检查失败，只是被前一错误
  提前遮蔽。
- 经维护者明确同意，verify job 的 checkout 改为完整只读历史；runner 在名称含 `test`、0700、
  带 owner marker 的临时目录中从删除前完整 Commit `08a1c4908c8890dad5284e9682304e1ac0c7550e`
  精确提取 news/wiki/members，并要求恰好 260 个 Markdown。快照路径只注入 CMS 测试步骤，不
  进入 production build、镜像或运行配置；本地 annotated tag 继续保留，但 CI 不依赖未推送 tag。
- 新增阶段 11 静态回归，固定 full-history、删除前 Commit、test 路径、环境变量、260 文件门禁和
  `if: always()` marker 清理。修复后完整测试 132/132、CMS 109/109、阶段 10 为 33/33、阶段 11
  为 12/12 + Markdown/XSS 4/4 + Wiki 226/226；fresh migration、typecheck、production build、
  Shell/工作流契约和 diff 检查均通过。完整本地独立修复 Commit SHA 由交付回复报告。
- 本修复不改变 V2.0 已通过结论、数据库、API、依赖或生产行为；不 Fetch、不 Push、不部署，
  不访问生产数据库/S3/GitHub 写接口，不进入新阶段。
- 初始 CI 修复 Commit `b73a4a94de47b117ed6afd75776d048452e1c50b` 推送后的下一次 run
  暴露远端并不存在本地 annotated tag；`fetch-depth: 0` 只能取得远端对象，不能取得未推送 tag。
  GitHub 只读核对确认 tag 目标完整 Commit `08a1c4908c8890dad5284e9682304e1ac0c7550e`
  存在于远端主线历史。workflow、full suite 和 Markdown/XSS 套件因此统一改用该 40 位 SHA；
  本地 tag 不删除、不推送，也不再是 CI 前置条件。
- 修正后远端兼容静态契约、YAML、260 文件归档、marker 清理、阶段 11 专项 12/12、历史
  Markdown/XSS 4/4、Wiki 226/226、完整测试 132/132、CMS 109/109、阶段 10 回归 33/33 和
  fresh migration 再次通过。新建独立本地修复 Commit，完整 SHA 由交付回复报告。
- 远端 tag 独立性修复 Commit `3142955f4818de3e13abdf15fb2e15492485b9b8` 推送后的 run 已通过
  阶段 11 前置 12/12、历史 Markdown/XSS 4/4 和 Wiki 226/226，随后在 operations shell 测试
  因 GitHub Ubuntu runner 未安装可选 `rg` 而退出。核对发现两条位于 `if` 条件中的 `rg` 扫描
  还会在命令缺失时悄悄跳过安全断言，故不能只修最后一条显式失败命令。
- 阶段 11 会调用的 operations、systemd 和自动部署 shell 测试已全部改用 runner 自带的
  `grep`，保持递归、扩展正则和固定字符串语义；总入口会先明确检查实际所需命令，并静态拒绝
  `tests/*.sh` 再引入可选 ripgrep 依赖。修复后的精确 `npm run test:v2:phase11` 已完整通过，
  包括 operations、真实 systemd/logrotate、当前用户迁移、自动部署、清理和阶段 7 回归。
- 该修复不改变产品代码、数据库、API、依赖、权限或生产行为；继续不 Fetch、不 Push、不部署，
  不访问生产资源。独立本地修复 Commit 完整 SHA 由交付回复报告。

---

## 2026-08-03：CMS 沉浸式编辑与正式效果双栏预览

- 从干净 `main` `6622627f03edd4b4445ed2f1b353bb66df455581` 开始，接手时 HEAD 与
  `origin/main` 相同、ahead/behind 为 0/0。本轮没有 Fetch、Push、Reset、Rebase、Amend、
  Squash、SSH 或部署，也没有访问位于 `10.0.0.4` 的生产服务器。
- 草稿页面调整为富文本单栏和 Markdown 源码/正式效果双栏两个模式；桌面端源码和预览按进度
  同步，正文重渲染后保持同一进度，移动端在两个持续挂载的面板之间切换。文章信息改为
  独立弹层，富文本继续使用 Crepe 工具栏、选区工具栏和斜杠菜单。
- 新增提示框、参数卡、视频和下载卡片共享注册表、插入/整段源码编辑入口及正式 Vue 渲染组件。
  CMS 预览和新闻、Wiki、成员页面继续共用 `VinciMarkdownRenderer`、Comark、代码高亮和正文
  CSS；各 collection 通过 variant 使用对应正式样式。
- 富文本保护管线继续把 HTML、Vue/MDC、模板 token 和未知扩展作为原文/占位保留。最终渲染
  允许普通 HTML、HTTPS iframe 和登记组件，只把 `script` 转为可见安全代码，并移除 `on*`、
  `srcdoc` 和可执行 URL。处理不回写正文，未知语法不做自动修复或删除。
- PostgreSQL 现有 `body`/Revision Markdown 字段已经完整承载上述源码，因此本功能不新增表、
  字段或 Migration，不改变 API、审核、发布、Outbox 或导出模型；没有恢复代码仓库 `content/`，
  没有引入 Nuxt Content，也没有改动 Wiki 拼音/章节模块。
- 本机隔离验证通过：编辑器/Comark/阶段 10 定向回归 18/18；历史 Markdown 富文本保护 5/5；
  固定删除前快照共 260 个 Markdown，Wiki 226/226 的 order、URL 与站内链接检查通过；typecheck、
  production build 和 `git diff --check` 通过。build 仅有既有静态图片解析、chunk 体积和并行
  prerender `console.time` 警告。曾启动的完整 Phase 11 本机 test 套件因包含无关旧运维用例且
  长时间无进度而人工停止；其 test 容器、数据库 volume、network 和临时快照已由退出钩子清理。
- 新增 `docs/CMS_EDITOR_GUIDE.md`，包含使用方式、登记组件扩展流程、权限/安全/异常、明确非目标、
  本机验证和回滚。实现使用新的独立本地 Commit；完整 SHA 由交付回复报告。

---

## 2026-08-03：CMS 本地文章详情、富文本兼容与 Wiki 预览回归修复

- 用户在 `npm run dev` 中反馈：从文章列表进入详情后卡住，刷新被误报为 404；生产富文本被
  “无损往返检查”拒绝；Wiki 右侧预览缺少正式页面的自动标题编号。本轮只在本机诊断和验证，
  未连接、SSH 或修改 `10.0.0.4`，未 Fetch、Push、部署或访问生产数据。
- 数据库权威模式的 CMS 详情改为直接读取当前 `article_revisions.body/frontmatter/content_hash`，
  不再重复解析历史 `markdown_source`。详情页同时传播 API 的真实错误码和消息，只有确实没有
  返回文章时才生成 404；文章详情预览补传 collection variant。本修复不需要 Migration。
- 富文本初始检查不再比较过严的 Remark 源码 AST，改为使用正式 Comark 插件核对最终渲染树，
  并单独逐项检查 HTML、Vue/MDC、模板指令等受保护源码。真实 Chromium 对删除前历史快照的
  228 篇 news/wiki 正文检查中，原逻辑误拒 137 篇；新逻辑允许其中 192 篇，仅对 36 篇确实会
  改变网页效果或扩展原文的旧 Markdown 保持安全回退。
- Wiki 标题跳级编号抽到 `app/utils/wiki-heading-numbering.ts`，正式 Wiki 页和
  `VinciMarkdownRenderer` 的 Wiki variant 共用。CMS 草稿预览和正式文章详情因此显示与前台
  相同的编号；Wiki 拼音路径和章节模块没有改动。
- 新增回归覆盖最终渲染等价规范化、扩展语法原文、标题跳级编号、详情真实错误和 Revision
  权威字段。数据库集成用例只会在显式、名称含 test 的隔离 `TEST_DATABASE_URL` 下运行。
  实现使用新的独立本地 Commit；完整 SHA 由交付回复报告。

---

## 2026-08-03：Markdown 源码与发布效果双向滚动

- 根据维护者反馈，源码双栏从“源码单向驱动预览”调整为双向同步。最近由用户主动滚动的源码
  或预览面板成为本轮驱动方，另一侧按可滚动高度的相同进度定位。
- CodeMirror 暴露受控 `setScrollProgress`，编辑器和预览分别记录程序设置的目标位置并吞掉
  对应滚动事件，避免循环触发、抖动和滚动控制权反复切换。正文重渲染继续恢复当前进度，移动
  端面板重新显示后再同步，原生 textarea 回退也使用相同规则。
- 本功能不改变正文、数据库、API、权限或安全策略，不需要 Migration。实现使用新的独立本地
  Commit；完整 SHA 由交付回复报告，不 Push、不部署。

---

## 2026-08-03：仓库静态媒体迁移与 CMS 图片内容命名

- CMS 粘贴、拖入和文件选择上传的图片仍由服务端统一转换为 WebP，但对象文件名从随机 UUID
  改为 `<Unix毫秒>-<最终WebP的SHA-256前8位>.webp`；年月、草稿 ID、数据库登记、编辑锁、
  权限和 S3 配置模型不变，不需要数据库 Migration。
- 仓库原有 56 张图片转换为 WebP，首页 MP4 按维护者最终决定不压缩、不转码、逐字节复制；
  生成的 57 个对象由维护者手动上传到 `cdn.sdutvincirobot.top/site-assets/`。上传后已逐项 GET
  核对状态、Content-Type、长度和 SHA-256，视频 Range 请求返回 206。
- `shared/utils/static-media.ts` 登记 57 条旧路径到 CDN 的确定性映射。站点直接引用已切换；
  正式 Comark 渲染器只改写元素/组件属性中的登记路径，代码文本和未知 `/images/...` 保持
  原样；公开文章 frontmatter、成员头像和 CMS 头像预览同样兼容旧数据库值。PostgreSQL 正文
  没有直接改写。独立 `sdutvinci_content` 仓库另建分支
  `agent/migrate-static-media-to-cdn`，将 32 个成员头像和新闻正文中的 10 个唯一静态对象（共
  43 处引用）改为已校验的 CDN URL，并创建 Draft PR #1；现有 Wiki 旧 CDN 引用保持不变。
  正式数据库仍应只通过既有 PR 审核/导入流程更新。
- CDN 校验、映射回归、typecheck、production build 和本地隔离 HTTP 冒烟通过后，57 个
  `public/images` 文件从当前工作树移除；可从 Git 历史恢复，本地忽略的 `cdn-upload/` 仍保留。
  新增 `docs/STATIC_MEDIA_MIGRATION.md` 记录对象目录、转换规则、复现、上传、验证和回滚流程。
- 测试只使用名称、数据库、账号、密码和端口均明确隔离的 PostgreSQL test 容器；相关数据库
  集成 9/9、媒体/编辑器定向单元 12/12、本机构建产物 `/`、`/contact`、`/recruitment`、
  `/cms/login` 均返回 200。临时容器、端口和文件均已清理。没有连接 `10.0.0.4`、生产数据库或
  生产 S3，没有 SSH、Fetch 或部署。仅按维护者明确选择向 `sdutvinci_content` 推送上述独立
  分支并创建 Draft PR；`sdutvinci_web` 不 Push。Web 仓库独立本地 Commit 完整 SHA 由交付
  回复报告。

---

## 2026-08-09：生产健康检查、日志轮转与常驻 Worker 版本修复

- 经维护者明确授权连接 `10.0.0.4` 检查并处理问题；按维护者要求未处理 TLS 证书。检查时
  线上活动应用为 `bcfd53756508e7d14d00642f2d247b019d3381e2`，应用、PostgreSQL、gateway
  容器均健康且无重启；核心公开页面和 CMS 登录页返回 200，数据库指针、导出队列、对象存储、
  定时任务、当日备份及最近七次 03:00 内容对账均正常。
- 修复了 `logrotate.service` 连续失败：systemd 在应用 `User=` 前以 root 打开 append 日志，
  与 logrotate 的 `su` 用户不匹配。本次仅将五个 Vinci 运维日志恢复为运行用户属主和 `0600`，
  强制执行 Vinci 专用轮转并重新运行服务；轮转成功、历史内容保留，后续定时任务写入后属主
  仍正确，系统失败单元为 0。
- 已启用的常驻内容导出 Worker 仍在使用旧 operations 镜像。本次确认导出队列为空后，只拉取并
  强制重建该 Worker 为当前线上 Commit 的精确镜像；重建后处于 idle、jobCount 0、failed 0、
  restart 0。应用、PostgreSQL 和 gateway 的启动时间未变化，未写业务数据、未执行 Migration。
- 永久修复会让 systemd 安装器安全预创建/修复五个日志文件；符号链接、硬链接和非普通文件会
  fail closed。应用部署只在 Worker 原本已运行时同步其镜像，并在后续部署失败时尝试恢复原精确
  镜像；未启用时不会自动启动。相应安装、logrotate 和部署静态回归已补充到测试及运维文档。
- 生产仓库未改动，未部署应用代码；本地永久修复将以独立 Commit 交付，不 Push。生产侧最终
  `./vinci doctor` 报告 issueCount 0，公开首页、新闻、Wiki、团队、CMS 登录及本机 health
  均返回 200。

---

## 2026-08-09：CMS 深色模式切换

- 已登录 CMS 顶部工具栏新增亮色/深色切换按钮，复用全站 `data-theme` CSS token 和
  `vinci-theme` 浏览器本地偏好；首次访问沿用系统配色，切换后立即生效并在刷新后保留。
- 按钮提供动态中文标签、提示和 `aria-pressed` 状态；窄屏保留图标按钮。浏览器限制本地存储时
  当前页面仍能切换，刷新后回到系统偏好。
- 本功能是浏览器显示偏好，不调用 API，不新增数据库表、字段、Migration、依赖或环境变量，
  不改变权限、草稿、Revision、审核、发布、导出或 Markdown 渲染。
- 没有恢复代码仓库 `content/`，没有引入 Nuxt Content，没有修改 Wiki 拼音路径或章节模块，
  没有 SSH、生产数据操作、Push 或部署。

---

## 2026-08-09：CMS 一键本地测试环境

- 新增 `scripts/cms-local-test.sh`，以 `start|status|restart|stop` 管理只监听回环地址的隔离
  PostgreSQL 和 Nuxt 开发容器；资源使用固定 test 名称与归属标签，名称或标签不匹配时拒绝清理。
- `start` 自动执行完整 Migration，从同级干净 `sdutvinci_content` 只读导入 228 篇文章和 32 名
  成员及当前 Revision，并创建管理员 `testadmin`；不读取或修改项目 `.env`。
- 固定测试密码只用于一次性本地数据库，教程明确记录启动、登录、端口覆盖、日志、重建和不可恢复
  清理行为。未新增生产 API、Migration、环境变量或部署行为。

---

## 2026-08-09：CMS 浅色侧栏与工作台适配

- 根据完整内容环境的浏览器验收反馈，浅色模式现显式覆盖原先固定深色的侧栏、导航、用户区与
  工作台欢迎卡；深色模式原视觉保持不变。
- 浅色配色继续复用现行 token，补齐文字、图标、活动态、边框、按钮、头像与状态栏对比度；
  不改变布局、权限、API、数据库或内容模型。
- `/cms/login` 的独立认证布局现也提供相同主题切换按钮，并显式适配浅色背景、品牌区、功能说明、
  登录卡片、表单控件与页脚；登录前后的选择共用 `vinci-theme`，刷新和跳转不会丢失。
- 浅色登录页的背景蒙层按纵向和横向渐变控制透明度，避免整页白色覆盖导致团队照片不可辨识；
  功能栏使用局部半透明承托，兼顾照片展示和文字对比度。
