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
