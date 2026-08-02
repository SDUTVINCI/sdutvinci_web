# Vinci V2.0 运维短手册

本文是普通维护者的现行入口。详细前置条件、逐步预期、失败处理、回滚和安全说明见
[`docs/v2/OPERATIONS.md`](v2/OPERATIONS.md)；备份/灾难恢复细节见
[`docs/v2/BACKUP_AND_RECOVERY.md`](v2/BACKUP_AND_RECOVERY.md)；`.env.example` 全部字段的填写方法见
[`docs/v2/ENVIRONMENT_CONFIGURATION.md`](v2/ENVIRONMENT_CONFIGURATION.md)。阶段 10 及更早文档
只作审计，不要执行其中已经退役的 Nuxt Content、代码仓库 Markdown 或固定部署用户流程。

## 1. 日常短流程

所有命令都在代码仓库根目录、以执行首次安装的当前普通用户运行。脚本仅在安装 root-owned
systemd/logrotate 文件时调用 `sudo`，不会自动把用户加入 Docker 组。首次安装前准备 Docker
Engine/Compose、Git、Node.js 24、curl/coreutils、systemd-analyze、logrotate 和 sudo。

先验证宿主机 Node，而不是只看 nvm 是否曾在另一个终端安装：

```bash
command -v node # 必须输出 /usr/bin/node 或 /usr/local/bin/node 等非交互可见路径
node --version  # 必须以 v24. 开头；command not found 时不要继续 clone/install
```

Debian 13 的系统级 NodeSource 24.x 安装、安装脚本审阅、非交互 PATH 验证和失败处理见完整运维
手册第 1 节。仅在 `.bashrc` 中加载的 nvm Node 不满足 systemd 运维任务要求。

全新服务器先创建当前用户自己的完整 main clone；如果目标目录已存在，停止核对，不能覆盖或与
V1 目录混用：

```bash
install -d -m 0750 "$HOME/services" # 创建当前用户拥有的服务父目录
cd "$HOME/services"                  # 进入 clone 父目录
test ! -e sdutvinci_web              # 预期成功；已存在时禁止继续覆盖
git clone --branch main --single-branch \
  https://github.com/SDUTVINCI/sdutvinci_web.git # 克隆 main 完整历史，不使用浅克隆
cd sdutvinci_web                      # 后续命令全部在仓库根执行
git status --short --branch           # 预期：main 跟踪 origin/main，工作区无改动
git remote get-url origin             # 必须与 .env 的 DEPLOY_GIT_REMOTE_URL 完全一致
git rev-parse HEAD                    # 记录镜像所对应的完整 40 位 SHA
```

先确认该 SHA 的 runtime/operations 镜像均已由 CI 发布，再创建 `.env`。完整镜像验证、失败处理和
为什么不能 `--depth=1`，见详细运维手册第 1 节。

```bash
cp -- .env.example .env                 # 仅全新 clone 使用；现有 .env 禁止覆盖
chmod 600 .env                          # 仅 owner 可读写；doctor 会拒绝权限过宽的配置
# 此处暂停：按 .env 逐项手册替换全部生产必填值，不能带着 replace-* 示例继续
./vinci install --dry-run               # 只读预检，不部署、不迁移数据库、不安装 timer
./vinci install --initialize=empty      # 全新空库：Migration、首个蓝绿槽位、五组 timer
./vinci update <40位SHA>                # 部署 CI 已发布镜像的指定完整 Commit SHA
./vinci status                          # 只读查看 SHA、slot、Compose、timer 和最近成功备份
./vinci doctor                          # 只读复验 DB、HTTP、内容/S3、磁盘、容器和 timer
./vinci backup --verify                 # 创建 custom dump、manifest、SHA256SUMS 并校验
./vinci maintenance --dry-run           # 只列备份/报告/临时包/镜像的候选清理项
./vinci maintenance --apply             # 执行受保护清理；先核对同环境 Dry Run
```

预期：安装显示实际用户名、UID、GID、Home 和 Shell；更新只走 app-blue/app-green；doctor
检查数据库、内容任务、S3/COS、磁盘、容器、gateway、活动槽位和 timer；备份只在成功后推进
latest-success；清理保护最新成功/最近可恢复/锁定备份、活动镜像和
`.deploy/rollback-verified` 指向的上一健康镜像。

任一命令失败时不要改 `.deploy/current`、不要删除 volume、不要 reset/rebase/Force Push。
先保存步骤、完整 SHA、脱敏日志和报告，再按详细手册处理。

## 2. 首次安装选择

`--initialize` 只接受以下两个值，二选一；它不是数据库名或任意标签：

| 值 | 什么时候用 | 会恢复什么 |
| --- | --- | --- |
| `empty` | 新站点，或明确放弃 V1 数据后从零部署 V2 | 只创建 V2 schema，不导入历史业务数据 |
| `snapshot` | 完整 PostgreSQL 备份不可用、目标库为空，但需抢救独立内容仓库中的公开内容 | 公开内容和当前 Revision；不含用户、草稿、完整历史、审核、审计 |

正常空内容库使用 `./vinci install --initialize=empty`。虽然当前省略参数也默认 `empty`，人工操作
仍必须显式填写，避免误判为自动迁移。只在上述受限条件成立时，才选择独立内容 snapshot：

```bash
./vinci install --initialize=snapshot --snapshot=/绝对/独立快照 # 只校验并给出精确令牌
./vinci install --initialize=snapshot --snapshot=/绝对/独立快照 \
  --confirm='INITIALIZE:上一轮输出的完整令牌' # 核对 item/hash/report 后才执行写入
```

普通应用启动永不自动导入 Markdown。snapshot 不能恢复用户、会话、草稿、全部 Revision、
审核和审计；正常换服务器必须走实例迁移包/完整 PostgreSQL dump。首条命令在完成 Dry Run 后
受控非零停止是预期行为。

## 3. 恢复与整机迁移

```bash
./vinci export-instance                    # 旧 V2 服务器导出 DB、Commit/bundle、镜像/槽位和清单
./vinci import-instance /绝对/迁移包 \
  --confirm='IMPORT:<包名>:<项目>:<数据库>' # 新 V2 服务器导入空库；令牌绑定包和目标库
./vinci restore /绝对/备份 \
  --confirm='RESTORE:<项目>:<数据库>:<备份目录名>' # 恢复已验证备份到空库
```

迁移包包含 custom dump、代码 Commit/bundle、镜像/槽位和无密钥配置清单，不包含真实 `.env`、
Token 或私钥。密钥材料须经独立加密通道传输。导入/恢复校验后只写空库，随后执行向前
Migration 和 loopback 健康检查；没有非空 override。`<项目>`、`<数据库>` 分别取新机 `.env`
中的 `COMPOSE_PROJECT_NAME`、`POSTGRES_DB`，`<包名>`/`<备份目录名>` 取路径 basename。两个命令
都要求确认值；缺少或错误时只报期望令牌并停止。

## 4. 自动调度

成功的 `./vinci install --initialize=empty|snapshot` 会按当前用户动态生成 unit；不同用户名/Home
的新服务器必须重新生成。`--scheduled` 是 unit 内部参数，维护者不需要手工调用。

| Timer | 时间 | 统一入口 | 作用 |
| --- | --- | --- | --- |
| auto-deploy | 每分钟 | `vinci update --automatic` | 检查不可变镜像并蓝绿更新 |
| backup | 02:00 上海 | `vinci backup --scheduled` | 备份、校验、成功后分层保留 |
| reconcile | 03:00 上海 | `vinci reconcile --scheduled` | DB→内容仓库全量对账 |
| cleanup | 04:00 上海 | `vinci maintenance --scheduled` | 备份/报告/临时/迁移包/镜像清理 |
| health | 每小时 | `vinci doctor --scheduled` | DB/内容/S3/容器/gateway/timer 诊断 |

日志位于当前用户拥有的 `VINCI_LOG_ROOT`，按日、30 份、100 MiB 双阈值轮转。

正式安装会自动启用以上 timer，不必另写 crontab。若需要重新生成或统一恢复全部 timer：

```bash
./vinci install --systemd-only # 不迁移数据库、不部署应用；重新生成并 enable --now 五个 timer
sudo systemctl list-timers --all 'vinci-cms-*' # 验证 NEXT/LAST，cleanup 应安排在 04:00 上海
```

auto-deploy timer 虽已启用，仍受 `.env` 的 `AUTO_DEPLOY_ENABLED` 控制，默认 `false`；首次人工发布
和回滚验收完成后才改为 `true`。backup/reconcile/cleanup/health 安装后即按上表运行。暂停或恢复
单个任务、日志检查和安全回滚命令见完整运维手册第 7 节。

## 5. 高级排障脚本

统一入口内部复用 `deploy.sh`、`auto-deploy.sh`、`backup*.sh`、`restore.sh`、
`cleanup-deploy-cache.sh`、`v2-maintenance-cleanup.sh` 和 `content-disaster-recovery.sh`。
这些底层脚本只供编排和高级排障；不要绕过统一确认、锁、路径、属主和健康检查。
