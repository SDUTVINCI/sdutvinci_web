# Vinci V2.0 运维短手册

本文是普通维护者的现行入口。详细前置条件、逐步预期、失败处理、回滚和安全说明见
[`docs/v2/OPERATIONS.md`](v2/OPERATIONS.md)；备份/灾难恢复细节见
[`docs/v2/BACKUP_AND_RECOVERY.md`](v2/BACKUP_AND_RECOVERY.md)。阶段 10 及更早文档只作审计，
不要执行其中已经退役的 Nuxt Content、代码仓库 Markdown 或固定部署用户流程。

## 1. 日常短流程

所有命令都在代码仓库根目录、以执行首次安装的当前普通用户运行。脚本仅在安装 root-owned
systemd/logrotate 文件时调用 `sudo`，不会自动把用户加入 Docker 组。首次安装前准备 Docker
Engine/Compose、Git、Node.js 24、curl/coreutils、systemd-analyze、logrotate 和 sudo。

```bash
./vinci install --dry-run       # 首次安装只读预检
./vinci install                 # 空内容库首次安装
./vinci update                  # 更新至 origin/main 最新完整 SHA
./vinci status
./vinci doctor
./vinci backup --verify
./vinci maintenance --dry-run
./vinci maintenance --apply
```

预期：安装显示实际用户名、UID、GID、Home 和 Shell；更新只走 app-blue/app-green；doctor
检查数据库、内容任务、S3/COS、磁盘、容器、gateway、活动槽位和 timer；备份只在成功后推进
latest-success；清理保护最新成功/最近可恢复/锁定备份、活动镜像和
`.deploy/rollback-verified` 指向的上一健康镜像。

任一命令失败时不要改 `.deploy/current`、不要删除 volume、不要 reset/rebase/Force Push。
先保存步骤、完整 SHA、脱敏日志和报告，再按详细手册处理。

## 2. 首次安装选择

空内容库使用 `./vinci install --initialize=empty`。只在 PostgreSQL 完整备份不可用且目标业务
库为空时，才选择独立内容 snapshot：

```bash
./vinci install --initialize=snapshot --snapshot=/绝对/独立快照
# 核对 Dry Run 后，以同一命令追加报告给出的精确 --confirm
```

普通应用启动永不自动导入 Markdown。snapshot 不能恢复用户、会话、草稿、全部 Revision、
审核和审计；正常换服务器必须走实例迁移包/完整 PostgreSQL dump。

## 3. 恢复与整机迁移

```bash
./vinci export-instance
./vinci import-instance /绝对/迁移包 --confirm='IMPORT:<包名>:<项目>:<数据库>'
./vinci restore /绝对/备份 \
  --confirm='RESTORE:<项目>:<数据库>:<备份目录名>'
```

迁移包包含 custom dump、代码 Commit/bundle、镜像/槽位和无密钥配置清单，不包含真实 `.env`、
Token 或私钥。密钥材料须经独立加密通道传输。导入/恢复校验后只写空库，随后执行向前
Migration 和 loopback 健康检查；没有非空 override。

## 4. 自动调度

`./vinci install` 按当前用户动态生成 unit；不同用户名/Home 的新服务器必须重新生成。

| Timer | 时间 | 统一入口 | 作用 |
| --- | --- | --- | --- |
| auto-deploy | 每分钟 | `vinci update --automatic` | 检查不可变镜像并蓝绿更新 |
| backup | 02:00 上海 | `vinci backup --scheduled` | 备份、校验、成功后分层保留 |
| reconcile | 03:00 上海 | `vinci reconcile --scheduled` | DB→内容仓库全量对账 |
| cleanup | 04:00 上海 | `vinci maintenance --scheduled` | 备份/报告/临时/迁移包/镜像清理 |
| health | 每小时 | `vinci doctor --scheduled` | DB/内容/S3/容器/gateway/timer 诊断 |

日志位于当前用户拥有的 `VINCI_LOG_ROOT`，按日、30 份、100 MiB 双阈值轮转。

## 5. 高级排障脚本

统一入口内部复用 `deploy.sh`、`auto-deploy.sh`、`backup*.sh`、`restore.sh`、
`cleanup-deploy-cache.sh`、`v2-maintenance-cleanup.sh` 和 `content-disaster-recovery.sh`。
这些底层脚本只供编排和高级排障；不要绕过统一确认、锁、路径、属主和健康检查。
