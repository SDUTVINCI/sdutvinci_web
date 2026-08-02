# Vinci V2.0 完整运维与维护手册

本文是阶段 11 的详细教程。所有地址、凭据和端口均为占位示例。不得把生产密码、Token、
私钥、数据库 URL 或带凭据远端写入命令历史、日志、Git 或工单。日常短流程见
[`docs/DEPLOYMENT.md`](../DEPLOYMENT.md)。

## 0. 通用安全约定

- 以执行首次安装的当前普通用户运行；用户名、UID、GID、Home、Shell 来自 NSS。
- 当前用户须能执行 `docker info`。Docker 组近似 root 权限，脚本不会自动加组。
- 仓库、备份、日志、对账、workspace 和迁移包根不得是 `/`、Home 根或 symlink，必须归当前
  用户所有；敏感目录为 `0700/0750`。
- 不 reset/rebase/amend/Force Push，不执行 destructive down migration，不覆盖非空库，不运行
  system-wide Docker/volume prune。
- 只保留完整 SHA、slot、run/job ID、报告 SHA、HTTP 状态和脱敏日志；不保存密钥值。

## 1. 全新服务器首次部署

### 前置条件

准备 Docker Engine/Compose、Git、Node.js 24、curl/coreutils、systemd/systemd-analyze、logrotate
和 sudo。Actions 已为目标 40 位 SHA
发布 runtime/operations 镜像。当前用户拥有代码 clone；`.env` 来自 `.env.example`、权限 0600，
真实值另存密码库。

### 命令

```bash
chmod 600 .env
./vinci install --dry-run
./vinci install --initialize=empty
./vinci status
./vinci doctor
```

快照首次初始化用 `./vinci install --initialize=snapshot --snapshot=/srv/vinci-snapshot-test`；首次
只输出 Dry Run，核对 item/hash/report 后才追加其精确 `--confirm`。

### 预期与验证

预检显示实际 user/UID/GID/Home/Shell、Compose 和动态 unit 通过。正式安装执行全部向前
Migration、候选健康、gateway 切换并启用五组 timer。`status` 显示 SHA/slot，doctor 为 0 issue，
loopback `/api/health` 为 2xx。

### 失败处理、回滚与安全

Docker 权限失败不要 chmod socket；由管理员选择 rootless 或审查组权限。镜像/Migration/候选
失败保留旧槽和脱敏日志。停新 timer 可回滚未投流安装；schema 只向前修复，绝不删
`postgres_data`。安装仅在写 root-owned unit/logrotate 时用 sudo；普通启动不导入 Markdown。

## 2. 当前用户权限与旧环境迁移

### 前置条件

`getent passwd "$(id -un)"` 可解析。旧环境迁移前须有 `.vinci-verified` 完整备份、无
`.deploy/operation.lock` 且已有维护窗口。

### 命令

```bash
./vinci doctor --legacy-user=<旧用户名> --legacy-root=<旧代码绝对目录> --dry-run
./vinci migrate-legacy-user --legacy-user=<旧用户名> \
  --legacy-root=<旧代码绝对目录> --dry-run
```

正式迁移额外提供 `--verified-backup=/绝对/已验证备份` 和提示的精确 `--confirm=MIGRATE:...`。

### 预期与验证

Dry Run 只列旧用户拥有的精确路径。正式流程停旧 timer，按 `find -xdev -user` 修属主，重新生成
当前 `User/Group/WorkingDirectory` unit。运行 doctor并观察一次 backup/reconcile/health 周期；
检查无旧属主、进程、cron 和启用 unit。

### 失败处理、回滚与安全

存在锁/进程时等待，不强杀；遇共享目录、ACL、symlink 或未知路径停止，绝不递归 chown Home、
`/opt` 或备份父目录。验收前可停新 timer、恢复已备份的旧 unit，但新旧不能并行。脚本永不
`userdel`；只有无进程/unit/key/ACL/文件/锁且恢复点有效时才由管理员人工删除旧账号。

## 3. GitHub Actions、镜像与内容仓库凭据

### 前置条件

代码 Actions 用仓库 `GITHUB_TOKEN` 写 GHCR；服务器代码 remote 只读。内容仓库使用单独、仅写
目标仓库 main 的细粒度凭据；PR 评论/关闭再用另一最小权限 Token。

### 命令

```bash
git remote get-url origin
docker login ghcr.io
ssh-keyscan -t ed25519 github.com > /受限路径/content-known-hosts
chmod 600 /受限路径/content-key /受限路径/content-known-hosts
./vinci doctor
```

### 预期与验证

origin 与配置完全一致；main 完整 SHA 有两种镜像。内容 Worker 只普通 fast-forward Push；PR
导入只读 Diff，评论/关闭独立确认，代码没有 Merge/Force Push 路径。

### 失败处理、回滚与安全

401/403 时撤销并重发最小权限凭据，不粘贴 header/stderr。known_hosts 变化通过可信渠道核对。
非快进时停 Worker 做只读对账，不 reset。撤销内容凭据不会回滚数据库发布；runtime app 不挂
Git/SSH key。三类凭据相互隔离。

## 4. PostgreSQL 备份、校验、恢复和清理

### 前置条件

PostgreSQL healthy；`BACKUP_ROOT` 是仓库外、当前用户拥有的 0700 绝对目录；磁盘高于 critical。

### 命令

```bash
./vinci backup --verify
./vinci backup-prune --dry-run
./vinci backup-prune --apply
./vinci restore /绝对/备份 --confirm='RESTORE:<项目>:<数据库>:<备份名>'
```

### 预期与验证

包含 custom dump、manifest、代码 SHA、无密钥清单和 `SHA256SUMS`。保留为 7 日/4 周/12 月，并
保护 latest-success、最新 `.vinci-verified` 和全部 `.vinci-locked`。恢复只接受空库，之后
Migration 和 HTTP 健康通过。

### 失败处理、回滚与安全

dump/校验失败不推进状态且不删旧备份。路径/owner/marker/symlink/磁盘/非空异常一律停止。
恢复失败保留隔离库，从新空库重演；业务回滚用新 Revision。普通包不含秘密。integrity marker
不等于可恢复，只有真实隔离恢复成功才能用精确 `RECOVERABLE:<目录>` 标记。

## 5. 旧服务器到新服务器完整迁移

### 前置条件

旧服务器 doctor 通过；新服务器 `.env`/密钥由独立加密通道配置；两端用户名/Home 可不同；
DNS TTL 和旧服务器保留窗口已安排。

### 命令

```bash
# 旧服务器
./vinci backup --verify
./vinci export-instance

# 新服务器
./vinci install --dry-run
./vinci install --systemd-only
./vinci import-instance /绝对/迁移包 \
  --confirm='IMPORT:<包名>:<项目>:<数据库>'
```

### 预期与验证

迁移包的数据库、代码 bundle/Commit、镜像/槽位和清单 SHA 通过且无秘密。导入拒绝非空目标，
完成 pg_restore、Migration、蓝绿、HTTP、内容任务和 S3/COS 检查。抽查用户、草稿、审核、
Revision、审计、内容和图片后再切 DNS。

### 失败处理、回滚与安全

传输哈希、代码、镜像或对象检查失败不切 DNS。后置失败保留新机现场，从新空库重演。回滚时
DNS/代理切回旧机；旧机在窗口内不升级/清理。迁移包和密钥分开传输，以 `.vinci-locked` 保留
回滚包；不同用户重新生成 unit，不能复制旧 Home 路径。

## 6. S3 / 腾讯云 COS

### 前置条件

Bucket 启用版本控制、防误删和可选跨区复制。应用凭据仅有目标 prefix 权限；doctor 至少有
HeadBucket/HeadObject。生命周期需先评估 Revision 引用。

### 命令

在供应商控制台配置版本/保留/复制和生命周期；填写 S3 兼容 endpoint、region、bucket、
path-style 后执行 `./vinci doctor`。

### 预期与验证

doctor 对全部 `media_assets.object_key` 检查对象与 public URL，只输出总数和缺失 key 哈希，
不输出路径或凭据。COS 按供应商要求设置 `S3_FORCE_PATH_STYLE`。

### 失败处理、回滚与安全

不可达先查 endpoint/DNS/时钟/region/最小权限。对象缺失时用哈希关联受控查询并从版本恢复，
不能删数据库记录掩盖。误生命周期先暂停，再从版本/复制恢复。不得删除仍被任何保留 Revision
引用的对象版本；数据库、内容仓库、S3 是三类独立灾备。

## 7. 蓝绿部署、回滚、日志和镜像清理

### 前置条件

目标 SHA 是当前线上后继且属于 origin/main；两镜像存在；工作树无跟踪改动；migration 为
expand/contract。

### 命令

```bash
./vinci update <40位SHA>
./vinci status
./vinci doctor
./scripts/cleanup-deploy-cache.sh --dry-run
```

### 预期与验证

按缓存清理→拉镜像→Migration→非活动槽健康→gateway reload 顺序执行，原子更新状态。清理
保留所有容器引用、活动/失败 marker、`.deploy/rollback-verified` 指向的上一健康版本，且每仓库
至少保留最近 3 个 SHA；即使回滚版本超过最近数量也不得删除。

### 失败处理、回滚与安全

候选失败保留旧槽，不循环重试同失败 SHA。查看轮转日志、Compose、候选 health 和 Migration。
用新修复 Commit 或普通 `git revert` 后重新部署；不直接覆盖容器、改 gateway 状态或 down。
日志按日/30 份/100 MiB 轮转且须脱敏；禁止 system/volume prune 和强删引用镜像。

## 8. 内容仓库、异步导出、03:00 对账和重试

### 前置条件

唯一内容仓库/main 与首次复制均存在；凭据最小化；workspace 和代码根分离。首次接管必须先按
阶段 6 手册 Dry Run 并由维护者确认。

### 命令

日常使用 `./vinci doctor` 和 `./vinci reconcile`；失败 Outbox 在 CMS 中明确手动重试。

### 预期与验证

数据库 Revision/Outbox 先提交，前台立即生效；Worker 普通 Commit 三类 Markdown 和 metadata；
03:00 从数据库修正受管路径，无差异不 Commit。doctor 汇总 pending/failed job、最近对账和 PR。

### 失败处理、回滚与安全

远端失败不回滚数据库；保留 job/run/error code。非快进、脏 workspace、symlink/未知文件时停写
并做只读报告。可停 Worker/timer，仓库错误用普通 revert 或 DB 对账纠正；不 reset/Force Push。
内容仓库不能覆盖非空数据库；PR 只建草稿/提案，不自动 Merge/批准/发布。

## 9. 灾难恢复

### 前置条件

先区分数据库、内容仓库、S3/COS。首选最新 `.vinci-verified` dump；内容 snapshot 仅在完整 dump
不可用时恢复公开内容；对象从 Bucket 版本/复制恢复。

### 命令

数据库完整恢复按第 4/5 节。最后手段：

```bash
./scripts/content-disaster-recovery.sh dry-run /绝对/快照 <维护者标识>
# 核对后在隔离空库提供上一轮精确确认值再执行 apply
```

### 预期与验证

格式/路径/ID/hash/引用通过；事务导入、后置 Migration、pointer/hash 和 loopback HTTP 通过。
snapshot 无法恢复用户/草稿/完整历史/审核/审计，不能猜测补齐。

### 失败处理、回滚与安全

任一校验失败停止；事务后失败保留整个隔离库，从新空库重演。切换前保留旧流量；内容仓库
纠正用普通 Commit，业务内容回滚用新 Revision。演练不连生产库，不把 URL/令牌交给验收者，
确认值绑定 mode、snapshot 和报告，且没有非空 override。

## 10. FAQ 与高级排障

### 前置条件与命令

先执行 `./vinci status`、`./vinci doctor`，记录时间、SHA、slot、timer、run ID 和脱敏错误码。

### 预期、失败处理与回滚

- timer 不运行：查 `systemctl status vinci-cms-<name>.timer`；不同 Home 后重新
  `./vinci install --systemd-only`。
- 自动部署不动：核对 enabled、origin、两镜像和失败 marker；不盲删 marker 重试同 SHA。
- 备份不清理：这是失败门禁；先修新备份/校验，再跑 Dry Run。
- 内容发布成功但仓库落后：数据库仍权威；查 Outbox/Worker 后明确重试。
- 图片 404：用 doctor 缺失哈希和受控查询从对象版本恢复，不删引用。
- 磁盘告警：扩容或按 Dry Run 清理；保护集合占满时停止，不突破保护。

底层脚本清单见部署短手册。未知路径/属主/特殊文件、非快进、非空恢复或遮盖异常必须 fail
closed；修复用新 Commit/向前 Migration并保留现场。工单不得附 `.env`、完整容器环境、
Authorization/Cookie、私钥、数据库 URL 或完整对象 key。
