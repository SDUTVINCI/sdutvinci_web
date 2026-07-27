# V2 阶段 0：现状复审、基线冻结与详细设计——实施与验收

## 1. 当前状态

- 实现状态：阶段 0 设计和只读审计已完成；不代表 V2 运行时已实现。
- 自动化验证状态：通过。
- 人工验收状态：维护者已确认验收结束并授权进入阶段 1，按验收通过记录。
- 是否允许进入下一阶段：是。

## 2. 本阶段范围

本阶段复审 V1 真实状态，冻结代码、内容和独立内容仓库基线，设计 V2 的 Schema、功能开关、序列化、内容仓库接管、当前用户运维、备份清理和灾难恢复边界。

本阶段没有创建 V2 业务 Migration，没有修改数据库、API、发布事务、前台内容来源、Nuxt Content、systemd 或生产部署行为；没有安装后续阶段依赖。

## 3. 实现内容

- 完整阅读 V2 需求、V1 需求、现有架构、部署和交接文档。
- 核验本地分支、HEAD、`origin/main`、远端 main、最近提交和初始工作区。
- 确认仓库及已检查父目录没有适用 `AGENT.md` / `AGENTS.md`。
- 新增无第三方依赖的只读审计入口，确定性统计内容和宿主机部署用户依赖。
- 冻结 260 个 Markdown 的路径、字节、Frontmatter 和扩展语法候选集。
- 只读核验已存在内容仓库；远端 `content` tree 与本地 `HEAD:content` 完全一致。
- 记录 V1 前台、CMS、发布、历史、图片、部署和备份链路。
- 完成集合级读取开关、发布/导出/导入开关和非法组合设计。
- 完成正式 Revision、Outbox、导出、对账、导入和冲突表草案。
- 完成 `vinciId`、路径安全、确定性序列化和快照 Manifest 规范。
- 完成 Comark 全量语料、阶段升级/回滚和数据保护计划。
- 完成 `vinci-deploy` 依赖盘点及迁移到当前安装用户的设计。
- 完成数据库、配置、内容、报告、日志、迁移包、临时目录、镜像和缓存保留策略。
- 完成首次部署、GitHub、PostgreSQL、S3/COS、新服务器迁移、内容仓库、蓝绿、灾备和 FAQ 教程目录。

## 4. 修改文件

| 文件 | 作用 |
| --- | --- |
| `docs/v2/VINCI_CONTENT_ARCHITECTURE_V2_REQUIREMENTS.md` | 维护者提供并移动到 `docs/v2/` 的 V2 权威需求；只更新阶段 0 已验证复选框 |
| `docs/v2/PHASE_V2_0_DESIGN.md` | 阶段 0 基线和详细设计 |
| `docs/v2/PHASE_V2_0_ACCEPTANCE.md` | 本验收文档 |
| `docs/CODEX_HANDOVER_V2.md` | V2 追加式交接记录 |
| `docs/ARCHITECTURE.md` | 追加已确认但尚未实现的 V2 目标约束 |
| `scripts/v2-phase0-audit.mjs` | 确定性内容/部署依赖只读审计 |
| `package.json` | 增加阶段 0 审计命令 |

未批量修改 `content/**/*.md`，未修改 Migration、运行时服务、Docker、systemd、部署或备份脚本。

## 5. 数据库变更

无。阶段开始和结束均应只有现有 `0000`～`0010` 共 11 个 SQL Migration 及 11 个 snapshot。详细 Schema 仅为草案。

## 6. API 变更

无。没有增加、删除或修改 Nitro API、页面路由或正式发布事务。

## 7. 依赖和环境变量

- 新增依赖：无。
- 锁文件变化：无。
- 新增或修改环境变量：无。
- 新增 npm 命令：`npm run v2:phase0:audit`。

审计脚本复用仓库已有 `remark` 和 `yaml`，不安装阶段 1 以后依赖。

## 8. 架构决定

1. V2 最终数据库权威，但切换前保持 V1 Git-first。
2. `news`、`wiki`、`members` 分别支持 `legacy_git`、`database_shadow`、`database`。
3. DB-first 正式发布与 Outbox 同事务；Git 导出在事务外异步完成。
4. 内容仓库 main 是只允许机器人普通 Push 的输出；PR 只能导入提案。
5. 内容仓库现有 `content/` 布局与目标根布局的差异必须在阶段 6 单独 Dry Run 和人工确认。
6. `vinciId` 使用数据库稳定 UUID，不由路径、标题或姓名派生。
7. V2 最终使用执行安装的当前系统用户，不写死 username、UID/GID 或 Home。
8. 清理永不删除最新成功、最近验证可恢复、锁定备份、活动镜像和至少一个已验证回滚镜像。

完整决定和设计见 `PHASE_V2_0_DESIGN.md`。

## 9. 自动化验证结果

最终验证结果：

| 命令 | 结果 |
| --- | --- |
| `npm run --silent v2:phase0:audit`，连续两次 `cmp` | 通过；输出完全一致，纯 JSON SHA-256 为 `f012582bc5bb752cc9480b7525dfc78ad7615b338838286d7d01f6edd92d15bd` |
| `npm run test:cms` | 通过；8 个测试文件、41 项测试 |
| `./tests/auto-deploy.integration.sh` | 通过 |
| `./tests/install-auto-deploy.integration.sh` | 通过 |
| `./tests/deploy-cache-cleanup.integration.sh` | 通过 |
| `npm run test:backup-restore` | 通过；校验和、空库恢复、forward migration、恢复标记、应用健康、非空拒绝和卷隔离均通过 |
| `npm run wiki:check` | 通过；226 个 Wiki 的 order、URL 和站内链接正常 |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过；Nuxt production build 完成 |
| shell `bash -n` / `sh -n` | 通过；运维、测试和容器入口脚本 |
| `docker compose --env-file .env.example config --quiet` | 通过 |
| `systemd-analyze verify` | unit 语法通过；因本机没有生产 `/opt/vinci-cms/scripts/auto-deploy.sh`，报告预期的 ExecStart 文件不存在提示 |
| Migration / runtime 边界检查 | 通过；11 SQL、11 snapshot，运行时、内容、部署、systemd、workflow 和锁文件无阶段 0 diff |
| `git diff --check` | 通过 |

CMS 首次测试调用使用了不含独立 `test` 段的数据库名 `vinci_v2_phase0`，被现有安全护栏在执行任何测试前拒绝。随后在同一个隔离容器内创建合规的 `vinci_v2_phase0_test` 并重跑，41 项全部通过。另一次 `systemd-analyze verify` 首次误用了不存在的 unit 文件名，改用仓库真实 `vinci-cms-auto-deploy.*` 后得到上表结果。两次调用错误均未修改仓库或生产资源。

### 测试环境

- 本地工作区；Node.js `v24.13.1`、npm `11.8.0`、Git `2.55.0`、Docker Engine `29.6.2`、Docker Compose `5.3.1`。
- 不连接生产数据库、生产 S3/COS、生产 Git 写端点或生产服务器。
- 数据库测试必须使用临时隔离 PostgreSQL。
- 外部内容仓库只允许读取公开元数据和 Git tree。

### 已执行命令

```bash
npm run --silent v2:phase0:audit
npm run --silent v2:phase0:audit
npm run test:cms
./tests/auto-deploy.integration.sh
./tests/install-auto-deploy.integration.sh
./tests/deploy-cache-cleanup.integration.sh
npm run test:backup-restore
npm run wiki:check
npm run typecheck
npm run build
git diff --check
```

附加静态边界检查包括 shell 语法、Compose 配置、systemd unit、Migration 数量、依赖/锁文件变化、运行时代码差异、审计结果重复性和 Git 工作区范围。

- 是否接触生产资源：仅只读访问了真实公开内容仓库的元数据和 Git tree；没有任何写操作。未接触生产数据库、生产 S3/COS、生产服务器、生产容器或 Git 写端点。

## 10. 安全检查

- 没有读取或写入真实密钥。
- 没有取得内容仓库写权限；没有 clone、branch、commit、push、delete 或 force push。
- 没有连接任何生产数据库、对象存储或服务器。
- 审计脚本只读取 `content/` 和受跟踪运维文件；发现符号链接或 Frontmatter 错误时失败。
- 清理设计默认 Dry Run、根目录 allowlist、主机互斥锁和保护集合。
- 外部 Markdown、原始 HTML、模板 token 和 PR 输入继续按不可信输入处理。

## 11. 已知限制

- 内容仓库只读核验确认 tree 一致，但没有测试 branch protection、机器人写权限或真实导出；这些属于阶段 6 人工和隔离验收。
- 语法扫描是词法/AST 候选盘点，不证明 Comark 兼容；完整渲染验证属于阶段 3。
- `vinci-deploy` 统计同时包含历史文档、测试、活动脚本和容器内部 `/home/node`；迁移工具必须按类别处理，不能机械替换。
- 当前内容仓库实际有 `content/` 前缀，与目标根布局存在差异，尚未更名。
- Schema、环境变量名、CLI 和保留策略是冻结设计输入，后续阶段仍需通过各自 Migration/接口评审和验收。
- RPO/RTO 尚未由维护者填写。

## 12. 回滚方法

阶段 0 只有一个独立 Git commit。人工验收前如需整体撤销：

```bash
git revert <阶段0-commit-sha>
```

预期结果：只移除阶段 0 文档、审计脚本和 npm 命令；V1 运行行为仍与阶段 0 前一致。

若维护者提供的 V2 需求文档需要保留，则不要整体 revert；使用新的普通 commit 恢复该文件，再验证 `git diff --check`。禁止 `git reset --hard`、Force Push 或删除内容仓库历史。

数据库、生产部署和内容仓库不需要数据回滚，因为本阶段没有写入。

## 13. 人工验收准备

维护者只需读取本 commit，不需要提供生产凭据或运行生产部署。建议在干净的临时 clone 或当前未改动工作区验收，并先确认 commit 只包含阶段 0 文件。

## 14. 人工验收步骤

### 14.1 核对提交范围

```bash
git status --short
git show --stat --oneline <阶段0-commit-sha>
git diff <阶段0-commit-sha>^ <阶段0-commit-sha> -- \
  server app content docker systemd .github compose.yaml
```

预期：

- 第一条没有意外改动。
- 第二条只显示第 4 节列出的阶段 0 文档、审计脚本和 `package.json`。
- 第三条不包含运行时、内容、部署或 systemd 行为变化。

失败处理：若出现来源不明文件或运行时修改，不验收、不 Push；保存 `git status` 和 diff 后交回修复。

### 14.2 核对代码和内容基线

```bash
git branch --show-current
git rev-parse <阶段0-commit-sha>^
git rev-parse <阶段0-commit-sha>^:content
npm run --silent v2:phase0:audit > /tmp/vinci-v2-audit-review.json
```

预期：

- 父提交为 `1752363a306d9c6bc0b44d1eb8a6ce359444637d`。
- 父提交 `content` tree 为 `be81f8c2c9114c33cdcfcb22f27e1464a64cf334`。
- 审计为 32 members、2 news、226 wiki、0 symlink、0 Frontmatter 错误。

失败处理：不要修改 Markdown 来“修复统计”；先确认分支、父提交和是否混入其他变更。

### 14.3 核对独立内容仓库事实

在 GitHub 网页只读打开 `SDUTVINCI/sdutvinci_content`：

1. 确认仓库已存在，默认分支为 main。
2. 确认基线提交为 `7636bca74a1591f78f7268927cbfa8ab677b24bb`。
3. 确认有 `content/members`、`content/news`、`content/wiki`。
4. 不点击创建、上传、删除、merge、设置写 Token 或 Force Push。

预期：首次复制与本文冻结值一致。若远端已有维护者新提交，只记录新 HEAD，不回退、不覆盖；阶段 6 重新建立基线。

### 14.4 审查核心设计

逐节检查 `PHASE_V2_0_DESIGN.md`：

- 数据库权威切换阶段和三个集合独立开关。
- Revision 不可变、DB 事务内 Outbox、Git 异步导出。
- 内容仓库 main/PR 权限和不得 Force Push。
- 确定性序列化、`vinciId` 和 Manifest。
- 阶段 0～11 的升级、回滚和数据保护。
- 当前用户识别、Home 解析、systemd、Docker、Git 属主迁移。
- 所有资产保留策略和五类强制保护对象。
- 灾备恢复顺序和详细教程目录。

预期：设计符合 V2 需求且没有把未来功能写成已实现。若不同意任何会改变后续 Schema、路径或权限的决定，记录具体章节；不要批准进入阶段 1。

### 14.5 复核自动验证

在不配置生产环境变量的机器运行第 9 节命令，数据库测试只指向临时隔离 PostgreSQL。

预期：所有命令退出 0；第二次审计与第一次字节一致；Migration 数量未变化。

安全注意：不要把生产 `DATABASE_URL`、S3/COS 密钥、GitHub 写 Token 或 SSH 私钥带入测试 shell。

### 14.6 给出结论

全部通过后，维护者明确回复：

```text
V2 阶段 0 验收通过
```

在该回复前不得开始阶段 1。若不通过，请列出文档章节、命令、实际结果和期望结果。

## 15. 人工验收预期结果

- 维护者确认现状盘点覆盖三类内容和全部主要链路。
- 维护者接受数据库、内容仓库、导入、当前用户和保留/灾备设计。
- 维护者确认没有改变线上行为或损坏已存在内容仓库。
- 所有人工复选框保持未勾选，直到维护者实际完成上述步骤。

## 16. 人工验收记录

- 验收结论：通过。
- 维护者确认时间：2026-07-27。
- 实现 Commit：`6a46251db9226aa5065dce35ab3a3b3c4a1ec85f`
- 验收修复 Commit：
- 维护者确认原文：`阶段0验收结束，收尾后执行阶段1`

## 17. 下一阶段注意事项

- 未收到明确验收原文前不得创建阶段 1 Migration。
- 阶段 1 只能使用隔离测试数据库做 expand Migration 和幂等回填。
- 首次回填必须先 Dry Run，逐篇核对 SHA，不能批量改写现有 Markdown。
- 内容仓库继续只读，阶段 1 不接入写权限。
- 任何维护者在基线后添加的内容或远端提交必须重新盘点，不得用本基线覆盖。
