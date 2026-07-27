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
