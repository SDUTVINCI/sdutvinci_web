# V2：备份、独立内容仓库、对账与灾难恢复手册

## 1. 适用范围和权威边界

本手册覆盖 V2 阶段 11 统一入口下的 PostgreSQL 备份、配置清单、凌晨全量对账、分层保留、
实例迁移、空数据库 Markdown 初始化和灾难恢复。PR 导入边界另见 `PR_IMPORT.md`。

- PostgreSQL 是新闻、Wiki 和成员线上正式内容的唯一权威。
- 正常换服务器必须恢复完整 PostgreSQL custom-format dump。
- 内容仓库是可读快照和受控灾难恢复材料，不包含用户、会话、草稿、审核、完整 Revision
  历史或全部审计，不能代替正常数据库备份。
- S3/COS 图片二进制必须通过 Bucket 版本控制、供应商备份或复制单独保护；数据库和
  Markdown 只保存引用。
- 普通应用启动没有 Markdown 导入钩子。`content-recovery` 是独立 Compose profile，
  默认不启动，也不持有未来普通 PR 导入权限。

所有首次操作必须在隔离 Compose project、名称含 `test` 的数据库、本地测试 Git 远端、
测试备份根和本机回环端口中演练。不要把生产凭据当作测试数据。

## 2. 定时任务

`./vinci install` 按当前安装用户动态生成并安装下列 systemd；不同用户/Home 的新服务器必须
重新生成，不得复制旧 unit：

| Timer | 时区和时间 | 入口 | 失败影响 |
| --- | --- | --- | --- |
| `vinci-cms-backup.timer` | `02:00 Asia/Shanghai` | `./vinci backup --scheduled` | 记录告警，不删除旧备份 |
| `vinci-cms-content-reconcile.timer` | `03:00 Asia/Shanghai` | `./vinci reconcile --scheduled` | 不反向修改数据库 |
| `vinci-cms-maintenance-cleanup.timer` | `04:00 Asia/Shanghai` | `./vinci maintenance --scheduled` | 不阻塞网站、发布或下一轮对账 |

使用前以 `./vinci install --dry-run` 审查渲染后的 unit、`WorkingDirectory`、执行用户、
目录属主和凭据挂载。另有每小时 `vinci-cms-health.timer` 执行综合 doctor。

只读检查定时表达式：

```bash
grep '^OnCalendar=' systemd/vinci-cms-*.timer
```

预期三行都显式包含 `Asia/Shanghai`，全量对账固定为 `03:00:00`。

## 3. 凌晨全量对账

### 3.1 数据流

```text
取得阶段 6 共用 advisory lock
→ fetch/ff-only 内容仓库 main
→ 从数据库 current Revision 生成完整临时快照
→ 比较 news、wiki、snapshot 和 manifest
→ 写只读 JSON 报告
→ 无差异：记录成功，不 Commit
→ 有差异：数据库状态覆盖受控路径，普通 Commit，非强制 Push
```

报告区分数据库新增、仓库缺失、字节修改、仓库多余文件和 metadata 差异，记录双方
SHA-256、base/result Commit 和报告 SHA。报告不保存 Git 凭据、私钥内容、数据库 URL
或原始未脱敏 stderr。

全量对账与阶段 6 增量 Worker 共用
`vinci:v2:content-export-worker` session advisory lock。锁忙时本轮记录 `busy` 并退出，
不会并发修改 workspace。CMS 工作台显示最近运行时间、成功/失败/互斥跳过、差异数量和
结果 Commit。

### 3.2 配置

复用阶段 6 唯一仓库、`main`、独立 SSH key、固定 known_hosts 和
`content_export_worktree`。新增：

```dotenv
CONTENT_RECONCILIATION_ROOT=/var/lib/vinci-cms/content-reconciliation
```

该根目录必须：

- 是绝对普通目录，不是 `/`，不经过符号链接；
- 与代码仓库、独立内容仓库 clone 和内容导出 workspace 不重叠；
- 只归运行用户所有；
- 包含精确归属标记；
- 下分 `snapshots/`、`reports/` 和 `tmp/`。

手动隔离触发：

```bash
docker compose -f compose.yaml -f compose.content-export.yaml \
  --profile content-reconcile run --rm content-reconcile
```

预期输出 `state: succeeded`。`report.counts.total: 0` 时远端 HEAD 不变化；有差异时只新增
一个普通父子 Commit。任何非快进、远端变化、脏 workspace、符号链接或特殊文件都会
fail closed。不要用 reset、Force Push 或直接 SQL 把失败记录改成功。

## 4. 自动数据库和配置清单备份

### 4.1 创建

```bash
./vinci backup --verify
```

脚本会：

1. 取得与部署/恢复共用的 `.deploy/operation.lock`；
2. 核对 Compose project、PostgreSQL 容器标签、数据库和用户身份；
3. 检查备份根绝对路径、非符号链接、属主和 `0700/0750` 权限；
4. 检查磁盘剩余空间；
5. 在带归属标记的 staging 目录执行 custom-format `pg_dump`；
6. 按配置重试并记录失败告警；
7. 用 `pg_restore --list` 和 `SHA256SUMS` 校验；
8. 写 V2 manifest、无密钥配置清单、应用 Commit 和异常 Git 取证资料；
9. 原子改名为最终备份目录；
10. 只在成功后更新 `.vinci-state/latest-success.json`。

关键配置及默认值：

```dotenv
BACKUP_RETRY_ATTEMPTS=3
BACKUP_RETRY_DELAY_SECONDS=2
BACKUP_MIN_FREE_BYTES=1073741824
BACKUP_CRITICAL_FREE_BYTES=536870912
```

低于 critical 阈值时拒绝开始并写 `BACKUP_DISK_CRITICAL`；低于预警阈值写
`BACKUP_DISK_LOW`。失败会追加 `.vinci-state/alerts.jsonl`，但不更新最近成功状态，
因此不会触发旧备份删除。

真实 `.env`、SSH 私钥、Token 和 S3 Secret 不进入普通包。`config-checklist.txt` 只记录
每个变量是 set 或 missing。真实敏感配置必须在独立加密密码库备份。

### 4.2 完整性和可恢复性是两件事

文件与 dump 结构校验：

```bash
./scripts/backup-verify.sh /绝对路径/备份目录
```

它写 `.vinci-integrity-verified`，不代表实际恢复成功。

只有在隔离空数据库完成 `pg_restore`、后置 Migration、内容完整性检查和 HTTP 健康
检查后，才可输入精确令牌标记“已验证可恢复”：

```bash
RECOVERY_VERIFICATION_CONFIRM='RECOVERABLE:<备份目录名>' \
  ./scripts/backup-mark-recoverable.sh /绝对路径/备份目录
```

这会写 `.vinci-verified`。禁止为了让清理脚本保留某个文件而伪造标记。

维护者锁定备份使用备份目录内的普通文件 `.vinci-locked`。锁定前应在变更记录中说明
原因、责任人和解除条件。

## 5. 分层保留和安全清理

默认策略：

```dotenv
BACKUP_RETENTION_DAILY_DAYS=7
BACKUP_RETENTION_WEEKLY_WEEKS=4
BACKUP_RETENTION_MONTHLY_MONTHS=12
CONTENT_SNAPSHOT_RETENTION_DAYS=30
RECONCILIATION_REPORT_RETENTION_DAYS=90
RECONCILIATION_TEMP_RETENTION_DAYS=1
```

先预览：

```bash
BACKUP_ROOT=/绝对/外部/备份根 ./scripts/backup-prune.sh --dry-run
./scripts/v2-maintenance-cleanup.sh --dry-run
```

核对 JSON 中 `protected` 和 `deleted` 后再去掉 `--dry-run`。备份清理永远保护：

- 最新成功备份；
- 最近一份 `.vinci-verified` 可恢复备份；
- 所有 `.vinci-locked` 维护者锁定备份；
- 每日、每周、每月分层选中的备份。

安全清理逐项验证根、相对路径、命名格式、普通文件/目录、归属标记、UID 和符号链接。
遇到未知目录、路径越界、错误属主、symlink 或特殊文件时整轮拒绝，不做部分猜测删除。
不使用 Docker/system-wide prune。阶段 10 后代码仓库不再存在三类正式内容目录；清理器
也不得把代码仓库或独立内容仓库根当作清理目标。

清理失败只使 cleanup unit 失败；备份、对账、网站和数据库发布不依赖清理成功。

## 6. 正常 PostgreSQL 恢复和新服务器迁移

正常迁移必须使用完整 dump：

1. 停止目标环境写入，确认是隔离或新服务器；
2. 启动一个全新空 PostgreSQL；
3. 核对 Compose project、数据库名、备份路径和 checksum；
4. 执行 `./vinci restore /绝对/备份 --confirm='RESTORE:<项目>:<数据库>:<备份名>'`；
5. 由统一入口复用 `scripts/restore.sh` 完成空库保护和 `pg_restore`；
6. 由统一入口运行所有向前 Migration；
7. 启动候选应用并完成完整性、登录、前台和 `/api/health` 检查；
8. 完成隔离演练后才标记 `.vinci-verified`；
9. 切换流量前保留旧服务器回滚窗口。

恢复脚本发现任一用户表时拒绝，不会清空、drop 或覆盖非空数据库。备份中的独立内容仓库
检查清单只供取证，不会自动覆盖数据库或内容仓库；实际 bundle 必须单独验证和保护。

## 7. 空数据库 Markdown 初始化和内容灾难恢复

### 7.1 权限和入口

两种模式共用严格校验器，但用途分开：

- `empty_database_initialization`：首次空库初始化；
- `disaster_recovery`：完整 PostgreSQL 备份不可用时的受控内容抢救。

二者只通过 operations CLI/`content-recovery` Compose profile 暴露，不提供普通 CMS
写 API，不读取 PR Diff，不创建普通导入草稿。入口必须显式
`CONTENT_RECOVERY_MODE=enabled`；应用和对账服务固定为 disabled。

### 7.2 Dry Run 校验

```bash
npm run v2:content:recover -- \
  --source=/绝对/内容快照 \
  --actor=维护者标识 \
  --mode=initialize
```

或使用 `--mode=disaster`。Dry Run 会验证：

- 数据库业务表完全为空；
- snapshot/manifest format、layout、serializer 均为 version 1；
- snapshot 自身 SHA-256；
- 每个文件路径、字节数、SHA-256 和 manifest 条目；
- UUID `vinciId`、article/revision 唯一性和路径唯一性；
- Markdown 重新确定性序列化后字节完全一致；
- `authors`/`contributors` 只引用快照中的稳定 member key 或
  `creditIdentities[].creditKey`；Markdown 始终保存拼音 ID，网页中文显示名由该快照字段恢复；
- 为保证迁移前历史快照仍可恢复，恢复器也接受与 `creditIdentities[].displayName` 精确相同的旧
  中文引用；这只是向后兼容边界，新写入和后续导出仍应使用稳定拼音 ID；
- 可选 source Commit 为 40 位 Git SHA。

输出只列即将新增的 article、member、tombstone 数量、哈希、报告 SHA 和精确确认令牌：

```text
INITIALIZE:<mode>:<snapshotSha256>:<reportSha256>:<itemCount>
```

任何格式、哈希、引用、路径或令牌错误都停止。

### 7.3 应用和事务保证

仅在重新运行 Dry Run、确认目标和报告后使用：

```bash
npm run v2:content:recover -- \
  --source=/绝对/内容快照 \
  --actor=维护者标识 \
  --mode=initialize \
  --apply \
  --confirm='INITIALIZE:...'
```

member、文章署名身份、article、current Revision、import item、import run 和 audit log 在一个数据库事务
内写入。任意一项失败全部回滚，不留下半篇文章、半个指针或虚假成功记录。成功报告保存
令牌哈希，不保存原始令牌。

不导入 snapshot tombstone 的正文，因为内容快照没有被删除 Revision 的完整正文历史；
完整数据库历史只能从 PostgreSQL 备份恢复。

### 7.4 受控灾难恢复编排

独立脚本：

```bash
./scripts/content-disaster-recovery.sh \
  dry-run /绝对/内容快照 维护者标识
```

保存令牌后，在同一个明确隔离环境：

```bash
CONTENT_RECOVERY_CONFIRM='INITIALIZE:disaster_recovery:...' \
RECOVERY_HEALTH_URL='http://127.0.0.1:<隔离端口>/api/health' \
./scripts/content-disaster-recovery.sh \
  apply /绝对/内容快照 维护者标识
```

编排顺序是：创建 schema 所需 Migration → 事务性内容恢复 → 再运行全部向前 Migration
→ pointer/hash 完整性检查 → 只接受本机回环 URL 的健康检查。任一步失败都停止；导入
事务失败不会留下半成品。若导入已经完整提交但后置 Migration/健康检查失败，保留整个
隔离数据库和日志取证，不要清单表或重跑覆盖；修复代码后从新的空隔离数据库重演。

## 8. 失败取证、回滚和清理

发生对账、备份或恢复失败时保留：

- 运行 ID、时间、触发方式、base/result Commit；
- 脱敏 JSON 报告和 report SHA；
- backup manifest、`SHA256SUMS`、latest-success 和 alerts；
- 数据库 Migration 输出、完整性 JSON、健康检查响应；
- Compose project、容器标签、数据库名、端口和临时根归属标记；
- 浏览器 URL、截图、Console/Network（若涉及 CMS 展示）。

不要保存原始密码、Token、私钥、带凭据 URL 或未脱敏 stderr。

代码回滚使用新的普通 `git revert <阶段7提交>`。Migration `0015` 是 expand-only；
回滚应用时保留新表，不执行 destructive down。对账可通过停用 timer/profile 停止，
不需要切回 Git-first。内容仓库误修正只能在审计数据库和报告后用普通 `git revert`
生成向前 Commit；不得 reset 或 Force Push。

测试资源只能在核对名称、Compose label、数据库名、端口和根目录归属标记后精确删除。
禁止宽泛 `docker system prune`、`docker volume prune` 或删除 `/tmp`、备份根、项目根。

## 9. 阶段 10 后的内容仓库与代码恢复点

代码仓库不再包含 `content/news`、`content/wiki` 或 `content/members`。普通应用 build、
runtime 和前台查询不读取内容 snapshot。独立内容仓库继续包含：

- `news/`、`wiki/`、`members/` 三类确定性 Markdown；
- `.vinci/snapshot.json` 与 `manifest.json`；
- 普通 Git 历史，作为导出、凌晨对账和 PR Base 的载体。

备份独立内容仓库时必须同时保存 refs/bundle 与工作树 snapshot/manifest，核对三类文件数、
总字节、逐路径 SHA-256、snapshot SHA 和 manifest SHA。只复制 Markdown 而遗漏 metadata
不能作为合格恢复材料。

阶段 10 删除前的代码恢复点为本地 annotated tag
`v2-phase10-pre-removal-20260802-08a1c49`，指向
`08a1c4908c8890dad5284e9682304e1ac0c7550e`。标签没有 Push。回滚演练只允许创建临时
worktree 读取该 tag，核对 260 个文件 manifest 后精确删除临时 worktree；不要 reset、
rebase 或移动当前分支。业务内容恢复仍优先使用 PostgreSQL dump，其次才是独立内容仓库
受控空库初始化，不能用旧代码 tag 覆盖现有数据库。

`wiki:check` 和全量 Comark/迁移兼容测试必须显式提供独立 snapshot 根：

```bash
WIKI_CHECK_SOURCE=/绝对/独立内容仓库快照 npm run wiki:check
V2_CONTENT_SNAPSHOT_SOURCE=/绝对/独立内容仓库快照 npm run test:v2:phase3
```

检查器拒绝代码仓库内目录和符号链接。production build 不设置这些变量，也不运行内容
snapshot 检查。

## 10. 阶段 11 实例迁移与迁移包清理

`./vinci export-instance` 生成包含数据库备份、代码 bundle/Commit、活动镜像/槽位、内容仓库与
S3/COS 无密钥清单和受控格式 marker 的实例包目录。真实 `.env`、Token、私钥不进入包。
`./vinci import-instance` 全量校验 SHA/bundle，拒绝非空库，再执行恢复、向前 Migration、蓝绿
健康、内容任务和对象存在性检查。

迁移包默认位于仓库外 `INSTANCE_EXPORT_ROOT`，保留 30 日；`.vinci-locked` 包不自动删除。
`./vinci maintenance --dry-run|--apply` 同时处理迁移包、备份、对账报告/临时目录和未引用镜像
缓存。首次导出前，由安装器创建且仍完全为空的实例包根没有 marker，清理会以
`uninitialized_empty` 安全跳过且不写入 marker；只要该无 marker 目录非空，或出现未知路径、
错误属主、symlink、特殊文件，整轮仍会 fail closed。
