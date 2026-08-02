# Vinci V2.0 完整运维与维护手册

本文是阶段 11 的详细教程。所有地址、凭据和端口均为占位示例。不得把生产密码、Token、
私钥、数据库 URL 或带凭据远端写入命令历史、日志、Git 或工单。日常短流程见
[`docs/DEPLOYMENT.md`](../DEPLOYMENT.md)；`.env.example` 的全部 86 个参数见
[`ENVIRONMENT_CONFIGURATION.md`](ENVIRONMENT_CONFIGURATION.md)。

## 0. 通用安全约定

- 以执行首次安装的当前普通用户运行；用户名、UID、GID、Home、Shell 来自 NSS。
- 当前用户须能执行 `docker info`。Docker 组近似 root 权限，脚本不会自动加组。
- 仓库、备份、日志、对账、workspace 和迁移包根不得是 `/`、Home 根或 symlink，必须归当前
  用户所有；敏感目录为 `0700/0750`。
- 不 reset/rebase/amend/Force Push，不执行 destructive down migration，不覆盖非空库，不运行
  system-wide Docker/volume prune。
- 只保留完整 SHA、slot、run/job ID、报告 SHA、HTTP 状态和脱敏日志；不保存密钥值。

### 0.1 怎么阅读命令

除非小节明确写了“旧服务器”或“新服务器”，所有命令都在代码仓库根目录、以执行首次安装的
当前普通用户运行。命令后的 `# ...` 是解释，不是额外参数；整行复制到 Bash 时注释会被忽略。

尖括号表示必须替换的占位符，不能原样执行。例如 `<40位SHA>` 应替换为 CI 已发布镜像的完整
40 位 Git Commit SHA；`/绝对/备份` 应替换为以 `/` 开头的真实路径。确认令牌必须逐字使用
前一轮 Dry Run 输出的值，不要自行拼写、复用旧值或放宽校验。

### 0.2 `./vinci` 安装参数速查

| 参数 | 填什么 | 作用和写入影响 |
| --- | --- | --- |
| `install --dry-run` | 不带值 | 只做环境、权限、Compose、动态 systemd unit 和 logrotate 预检；不部署、不迁移数据库、不安装 timer。 |
| `--initialize=empty` | 固定值 `empty` | 对全新空业务库执行 Migration，不导入历史内容，然后部署应用并安装 timer。首次空站点使用此模式。 |
| `--initialize=snapshot` | 固定值 `snapshot` | 在完整 PostgreSQL 备份不可用时，从独立内容仓库快照恢复公开内容；必须同时提供 `--snapshot=/绝对路径`。不能恢复用户、草稿、完整历史、审核或审计。 |
| `--snapshot=/绝对路径` | 独立内容快照根目录 | 目录须在代码仓库之外、非 symlink，并包含受控 `news/`、`wiki/`、`members/`、snapshot metadata 和 manifest。它不是旧 V1 工程里的 `content/`。 |
| `--confirm='精确令牌'` | 按对应命令说明构造或原样复制 | 允许执行恢复、导入或迁移等受保护写操作；snapshot/灾备令牌来自 Dry Run，restore/import/migrate 令牌由目标字段精确组成。 |
| `--systemd-only` | 不带值 | 只为当前用户重新生成并安装运维 unit/timer；用于已完成数据准备的新机迁移流程或用户名/Home 变化，不能替代正常首次部署。 |

`install` 省略 `--initialize` 时目前默认 `empty`，但教程和人工操作必须显式写
`--initialize=empty`，避免维护者误以为它会自动识别或导入历史数据。`empty` 与 `snapshot` 二选一，
一次首次安装不能先后执行两种模式。

## 1. 全新服务器首次部署

### 前置条件

准备 Docker Engine/Compose、Git、Node.js 24、OpenSSL、curl/coreutils、systemd/systemd-analyze、logrotate
和 sudo。Actions 已为目标 40 位 SHA 发布 runtime/operations 镜像。应用代码仓库允许只读 clone；
真实密钥另存密码库，不通过聊天、命令参数、Git 或工单传递。

### 第一步：确认运行身份和依赖

```bash
id                         # 确认当前普通用户、UID/GID 和 docker 组；不要用 root 长期运行应用
docker info                # 必须同时显示 Client 和 Server；permission denied 表示当前会话未取得权限
docker compose version     # 确认 Compose v2 可用
git --version              # 确认 Git 可用；下一步才开始 clone
command -v node            # 必须输出稳定的系统路径；command not found 时按下面步骤安装
node --version             # 预期为 v24.x；其他大版本不满足当前主机运维基线
```

如果管理员刚把用户加入 Docker 组，VS Code Remote SSH 中已经打开的终端不会自动取得新组；重新
连接 Remote SSH，或只在当前终端执行 `newgrp docker` 后再次运行 `id` 和 `docker info`。不要用
`chmod 666 /var/run/docker.sock` 绕过权限。

#### Debian 13 安装系统级 Node.js 24

如果 `command -v node` 或 `node --version` 失败，不能只在 VS Code 终端临时执行 `nvm use`。nvm
通常由交互 shell 的初始化文件加载，而 Vinci 的 systemd service 不读取 `.bashrc`；04:00 清理、
实例包保留等宿主机脚本通过 `/usr/bin/env node` 启动，必须在非交互 PATH 中找到 Node 24。

下面使用 NodeSource 24.x apt 仓库。网络安装脚本先下载到当前用户的私有目录，审阅后才以 sudo
运行；不要直接使用未经查看的 `curl | sudo bash`：

```bash
sudo apt-get update # 刷新 Debian 软件索引
sudo apt-get install -y ca-certificates curl gnupg less # 安装 HTTPS 仓库、签名和审阅工具
install -d -m 0700 "$HOME/.cache/vinci-bootstrap" # 创建仅当前用户可读的临时审阅目录
curl --fail --silent --show-error --location \
  https://deb.nodesource.com/setup_24.x \
  --output "$HOME/.cache/vinci-bootstrap/nodesource-setup-24.x.sh" # 下载 NodeSource 24.x 配置脚本
less "$HOME/.cache/vinci-bootstrap/nodesource-setup-24.x.sh" # 人工确认来源、24.x 和 apt 改动后退出
sudo bash "$HOME/.cache/vinci-bootstrap/nodesource-setup-24.x.sh" # 配置签名 key 和 nodistro apt 源
sudo apt-get install -y nodejs # 安装系统级 Node.js；该包同时提供 npm，不另装 Debian npm 包
```

安装后同时验证当前终端和接近 systemd 的干净环境：

```bash
command -v node # 预期为 /usr/bin/node 或 /usr/local/bin/node，不应位于 ~/.nvm
node --version  # 预期以 v24. 开头
npm --version   # 预期输出版本号
current_user="$(id -un)" # 保存当前普通用户名，不是 root
sudo -u "$current_user" env -i \
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  node --version # 预期仍以 v24. 开头，证明非交互 service 可找到 Node
```

若 apt 安装后不是 v24，执行 `apt-cache policy nodejs` 核对 candidate 是否来自
`deb.nodesource.com/node_24.x` 的 `nodistro` suite；不要继续安装。若组织禁止第三方 apt 源，应由
管理员把 Node 官方已校验的 v24 二进制安装到 systemd 默认 PATH，而不是只装到某个用户的 nvm。
官方来源与校验入口见 [Node.js v24 下载页](https://nodejs.org/en/download/) 和
[NodeSource Debian 安装说明](https://github.com/nodesource/distributions/blob/master/DEV_README.md)。

### 第二步：全新 clone V2 应用代码

下面把仓库放在当前用户 Home 下的 `services/`。可以改用其他当前用户拥有的目录，但不要覆盖旧 V1
目录，也不要使用 root 拥有的 clone。

```bash
install -d -m 0750 "$HOME/services" # 创建当前用户自己的服务目录；不需要 sudo
cd "$HOME/services"                  # 后续 clone 位于该目录下
test ! -e sdutvinci_web              # 必须成功；若目录已存在，先停下核对，禁止直接覆盖或混用 V1
git clone --branch main --single-branch \
  https://github.com/SDUTVINCI/sdutvinci_web.git # 完整克隆 main 历史，不使用 --depth=1
cd sdutvinci_web                      # 从这里开始，所有 ./vinci 命令都在仓库根执行
git status --short --branch           # 预期只有：## main...origin/main，不应有文件改动
git remote get-url origin             # 预期与稍后 DEPLOY_GIT_REMOTE_URL 完全一致
git rev-parse HEAD                    # 记录准备部署的完整 40 位 Commit SHA
```

不要在这里执行 `git clone` 时携带 Token，也不要把凭据写进 remote URL。`--single-branch` 只限制为
main，但仍保留 main 的完整历史；不能用浅克隆，因为自动部署的祖先关系检查、回滚和审计需要历史。
这一步克隆的是 V2 应用仓库，独立内容仓库由受控 workspace 管理，不能克隆进本仓库的 `content/`。

代码 Commit 必须已有两种同 SHA 镜像。若匿名 inspect 返回 `unauthorized`，说明还停在 GHCR
鉴权阶段，不能据此判断 tag 是否存在。到 GitHub 的 Developer settings 创建 Personal access
token (classic)，只选择 `read:packages`，设置合理到期时间；若组织要求 SSO，再为该 Token 授权
目标组织。GitHub Packages 当前不接受 fine-grained PAT 作为这里的替代品，账号本身也必须对
Package 有读取权限。官方说明见
[GitHub Container registry 鉴权](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)。

不要把 Token 写在命令行、`.env`、脚本或截图中。以下命令用隐藏输入暂存在当前 shell，传给
Docker 后立即 unset；必须以安装用户运行，不能 `sudo docker login`：

```bash
github_username='tungchiahui' # 填有目标 Package 读取权限的 GitHub 用户名
read -r -s -p 'GHCR read-only token: ' ghcr_read_token; printf '\n' # 粘贴 PAT classic，不回显
if printf '%s' "$ghcr_read_token" | \
  docker login ghcr.io --username "$github_username" --password-stdin; then # 预期：Login Succeeded
  ghcr_login_ok=true
else
  ghcr_login_ok=false
fi
unset ghcr_read_token
test "$ghcr_login_ok" = true # 必须成功；失败时停止，不继续 inspect/install
unset ghcr_login_ok
test ! -d "$HOME/.docker" || chmod 700 "$HOME/.docker"
test ! -f "$HOME/.docker/config.json" || chmod 600 "$HOME/.docker/config.json"
  # 没有 credential helper 时 Docker 配置含可还原认证材料，必须只允许当前用户读取
```

该 PAT 只需要 `read:packages`，不要授予 `write:packages`、`delete:packages` 或仓库写权限。Docker
登录状态必须属于执行 `./vinci install` 的同一普通用户，这样人工部署和 systemd 自动部署才能
读取同一份凭据。随后验证：

```bash
deployment_sha="$(git rev-parse HEAD)" # 仅保存非敏感的当前完整 Commit SHA
docker manifest inspect "ghcr.io/sdutvinci/sdutvinci_web:${deployment_sha}" >/dev/null
  # 上一行预期退出码 0：runtime 镜像存在
docker manifest inspect "ghcr.io/sdutvinci/sdutvinci_web-ops:${deployment_sha}" >/dev/null
  # 上一行预期退出码 0：operations 镜像存在
```

任一 inspect 失败时先确认 Actions 是否成功、GHCR 登录是否有 pull 权限以及 SHA 是否一致；不要改用
`latest`，也不要在服务器临时构建未经 CI 验收的生产镜像。错误含义：

- `unauthorized` 或 `denied`：仍是 Token scope、组织 SSO、Package 权限、用户名或登录用户错误；
- `manifest unknown`：鉴权已通过，但该仓库没有这个 SHA tag，检查对应 Actions 是否全部成功；
- 两条命令都以 0 退出：runtime/operations 同 SHA 镜像齐全，可以继续创建 `.env`。

### 第三步：创建并保护 `.env`

仅在全新 clone 且 `.env` 不存在时执行复制；如果文件已经存在，不要用示例覆盖它。

```bash
test ! -e .env                    # 新安装预期成功；若失败，先确认现有 .env 的来源，禁止直接覆盖
cp -- .env.example .env           # 创建本机配置；示例文件不含真实密钥
chmod 600 .env                    # 仅文件 owner 可读写，./vinci doctor 会拒绝过宽权限
stat -c '%a %U:%G %n' .env        # 预期类似：600 tungchiahui:tungchiahui .env
```

然后用受信任的本机编辑器填写 `.env`。至少逐项确认数据库、应用密钥、回环端口、镜像名和
`APP_IMAGE_TAG`；后者必须是 CI 已成功发布 runtime/operations 镜像的完整 40 位 SHA。S3/COS、
内容仓库和自动部署按实际需求配置，不要把配置值复制到终端输出。编辑完成后再次执行
`chmod 600 .env`。逐项填写方式、允许范围和错误影响见
[`ENVIRONMENT_CONFIGURATION.md`](ENVIRONMENT_CONFIGURATION.md)，不能用示例占位值通过生产验收。

首次部署最容易填错的字段如下；完整字段及安全默认值仍以 `.env.example` 为准：

| 字段 | 怎么填 | 注意事项 |
| --- | --- | --- |
| `COMPOSE_PROJECT_NAME` | 本机唯一、稳定的项目名，如 `vinci-cms` | 改名会形成另一组容器/volume；部署后不要随意改。 |
| `APP_IMAGE` / `APP_OPS_IMAGE` | Actions 实际发布的两个 GHCR 仓库 | runtime 与 operations 必须属于同一代码版本。 |
| `APP_IMAGE_TAG` | 已发布镜像的完整 40 位 SHA | 不使用 `latest` 作为生产发布目标。 |
| `APP_BIND_ADDRESS` / `APP_PORT` | 通常为 `127.0.0.1` / `3000` | 只监听回环；现有 1Panel 可继续从 18080 反代到 3000。 |
| `NUXT_PUBLIC_SITE_URL` | 用户访问的最终 HTTPS 地址 | 填公网 URL，不填容器内地址。 |
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | 本实例独立数据库名、账号和随机密码 | `DATABASE_URL` 中的特殊字符必须 URL encode；两处密码含义必须一致。 |
| `CMS_AUTH_SECRET` | 密码库生成并保存的至少 32 随机字节 | 不复用数据库、Git 或 S3 密码，不在终端回显。 |
| `S3_*` | 专用 Bucket/prefix 的最小权限凭据 | 开启版本控制；COS 同时核对 endpoint、region 和 path-style。 |
| `DEPLOY_GIT_REMOTE_URL` | 与 `git remote get-url origin` 完全一致 | 不能是带 Token/密码的 URL。 |
| `AUTO_DEPLOY_ENABLED` | 首次保持 `false` | 首次人工部署和回滚验收完成后才按第 7 节启用。 |
| `BACKUP_ROOT` / `INSTANCE_EXPORT_ROOT` / `VINCI_LOG_ROOT` | 仓库外的绝对目录 | 不得是 `/`、Home 根或 symlink；安装器会用当前用户创建安全权限。 |

### 第四步：只选择一种初始化模式

新站点或明确放弃 V1 业务数据时选择空库模式：

```bash
./vinci install --dry-run              # 只读预检；确认用户、路径、端口、Compose 和 unit 渲染
./vinci install --initialize=empty     # 写入空库 Migration、部署首个槽位，并安装/启用五组 timer
```

这里的 `empty` 是固定枚举值，不是数据库名。它表示“不导入任何历史内容”；命令仍会创建 V2
schema 并启动应用。不要先运行 `empty` 再尝试 `snapshot`，因为快照恢复会拒绝非空数据库。

只有完整 PostgreSQL 备份不可用、目标业务库为空，且确实需要从独立内容仓库恢复公开内容时，
才改用快照模式：

```bash
./vinci install --dry-run # 通用只读预检；成功后才进行下面的快照专用 Dry Run
./vinci install --initialize=snapshot --snapshot=/srv/vinci-content-snapshot # 校验并输出恢复计划/令牌
./vinci install --initialize=snapshot --snapshot=/srv/vinci-content-snapshot \
  --confirm='INITIALIZE:把上一条命令输出的完整令牌原样粘贴到这里' # 确认后才执行写入
```

第三条命令执行事务恢复、Migration、部署和 timer 安装；令牌不匹配或数据库非空会拒绝执行。
第二条未带 `--confirm`，完成快照 Dry Run 后以受控非零状态停止是预期行为，不表示校验失败；
`--confirm` 必须与它输出的值完全一致。快照模式只恢复公开内容及其当前 Revision，不能替代
完整实例迁移。

### 第五步：创建首个管理员并验收

```bash
./vinci status                         # 只读显示当前 SHA、镜像、活动槽、Compose、timer 和最近备份
./vinci doctor                         # 只读检查配置权限、DB、内容/S3、磁盘、容器、gateway 和 timer
docker compose --profile tools run --rm admin # 仅首次创建管理员时交互执行；密码只在提示中输入
curl --fail --silent --show-error http://127.0.0.1:3000/api/health # 本机验证回环健康，预期退出码 0
```

若 `.env` 配置了不同的应用回环端口，最后一条命令应使用该端口。管理员命令成功后不会在日志中
打印密码；再次创建前先确认确有新增账号需求。不得为了测试改动 1Panel 的 18080 反向代理。

### 预期与验证

预检显示实际 user/UID/GID/Home/Shell、Compose 和动态 unit 通过，且没有部署或数据库写入。
正式安装执行全部向前 Migration、候选健康、gateway 切换并启用五组 timer。`status` 显示
SHA/slot；`doctor` 以 0 退出且没有 issue；loopback `/api/health` 为 2xx。安装 timer 不代表自动
部署一定开启：只有 `.env` 中显式启用自动部署后，每分钟任务才会发布新 SHA。预检期间
`logrotate --debug` 的“debug mode does nothing”提示是只读校验的正常警告，不代表安装失败。

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
./vinci doctor --legacy-user=<旧用户名> --legacy-root=<旧代码绝对目录> --dry-run # 只读盘点旧残留
./vinci migrate-legacy-user --legacy-user=<旧用户名> \
  --legacy-root=<旧代码绝对目录> --dry-run # 只生成迁移清单，不停服务、不 chown、不删除账号
```

`<旧用户名>` 填旧部署账号名，`<旧代码绝对目录>` 填旧 clone 的绝对路径。正式迁移是在同一条
`migrate-legacy-user` 命令上额外提供 `--verified-backup=/绝对/已验证备份`，并原样追加 Dry Run
阶段核对得到的精确 `--confirm='MIGRATE:<旧用户名>:<当前用户名>:<旧代码绝对目录>'`。备份目录
必须已有 `.vinci-verified`，不能用仅完成哈希校验但未做隔离恢复验证的目录。

### 预期与验证

Dry Run 只列旧用户拥有的精确路径。正式流程停旧 timer，按 `find -xdev -user` 修属主，重新生成
当前 `User/Group/WorkingDirectory` unit。运行 doctor并观察一次 backup/reconcile/health 周期；
检查无旧属主、进程、cron 和启用 unit。

### 失败处理、回滚与安全

存在锁/进程时等待，不强杀；遇共享目录、ACL、symlink 或未知路径停止，绝不递归 chown Home、
`/opt` 或备份父目录。验收前可停新 timer、恢复已备份的旧 unit，但新旧不能并行。脚本永不
`userdel`；只有无进程/unit/key/ACL/文件/锁且恢复点有效时才由管理员人工删除旧账号。

这里的“旧环境迁移”只迁移操作系统账号、路径属主和动态 unit，不把 V1 数据模型升级为 V2。
如果 V1 数据库没有保留价值，先停用 V1 自动拉取和 timer、保留一份可识别的只读备份，再按第 1
节在全新空 V2 数据库执行 `--initialize=empty`；不要在 V1 容器上直接拉取 V2 main。若要保留 V1
业务数据，应使用专门的数据迁移/验收流程，不能用 `migrate-legacy-user` 代替。

## 3. GitHub Actions、镜像与内容仓库凭据

### 前置条件

代码 Actions 用仓库 `GITHUB_TOKEN` 写 GHCR；服务器代码 remote 只读。内容仓库使用单独、仅写
目标仓库 main 的细粒度凭据；PR 评论/关闭再用另一最小权限 Token。

### 命令

```bash
git remote get-url origin                    # 只读确认代码 remote，没有用户名、Token 或嵌入式密码
# GHCR 登录使用第 1 节的隐藏输入和 --password-stdin，Token 只授予 read:packages
ssh-keyscan -t ed25519 github.com > /受限路径/content-known-hosts # 采集候选 key，仍须可信核对
chmod 600 /受限路径/content-key /受限路径/content-known-hosts # 两个文件仅 owner 可读写
./vinci doctor                               # 验证配置可用且输出已遮盖敏感值
```

执行 `ssh-keyscan` 前先设 `umask 077`，并确认目标文件不是 symlink；采集到的 key 不是身份认证，
必须再与官方公布的指纹或既有可信渠道核对。

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
./vinci backup --verify                      # 创建 custom dump、哈希清单并执行完整性校验
./vinci backup-prune --dry-run               # 只列分层保留后可删除项，不删除任何备份
./vinci backup-prune --apply                 # 按上一轮规则执行清理；受保护/锁定备份仍不会删除
./vinci restore /绝对/备份 \
  --confirm='RESTORE:<项目>:<数据库>:<备份名>' # 仅恢复到空库；字段必须与本次目标完全一致
```

`<项目>` 和 `<数据库>` 分别填写 `.env` 中的 `COMPOSE_PROJECT_NAME` 与 `POSTGRES_DB`；`<备份名>`
是备份目录 basename，不是随意备注。`restore` 没有“跳过确认”的预览模式：先用
`./vinci backup --verify` 和备份 manifest 核对目标，再构造精确令牌；缺少或写错确认值时脚本只
报出期望值并停止，不会恢复。

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
./vinci backup --verify                      # 生成并校验迁移前数据库备份
./vinci export-instance                      # 生成无密钥实例迁移包、manifest 和 SHA256SUMS

# 新服务器
./vinci install --dry-run                    # 只读确认新用户名/Home、Compose、路径和 unit
./vinci install --systemd-only               # 为新机当前用户安装 timer；不导入数据库或启动应用
./vinci import-instance /绝对/迁移包 \
  --confirm='IMPORT:<包名>:<项目>:<数据库>' # 只导入空目标；令牌绑定迁移包和目标库
```

`<包名>` 填迁移包目录 basename；`<项目>` 和 `<数据库>` 填新机 `.env` 中的
`COMPOSE_PROJECT_NAME` 与 `POSTGRES_DB`。`import-instance` 没有无确认预览模式；缺少或错误令牌
只报期望值并停止。执行前人工核对包内 manifest 和 SHA256SUMS。`export-instance/import-instance`
适用于 V2 到 V2 的完整迁移，不是 V1 数据库升级工具。

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
path-style 后执行：

```bash
./vinci doctor                 # 只读检查 bucket/object 可达性；输出只含计数和缺失 key 哈希
```

### 预期与验证

doctor 对全部 `media_assets.object_key` 检查对象与 public URL，只输出总数和缺失 key 哈希，
不输出路径或凭据。COS 按供应商要求设置 `S3_FORCE_PATH_STYLE`。

### 失败处理、回滚与安全

不可达先查 endpoint/DNS/时钟/region/最小权限。对象缺失时用哈希关联受控查询并从版本恢复，
不能删数据库记录掩盖。误生命周期先暂停，再从版本/复制恢复。不得删除仍被任何保留 Revision
引用的对象版本；数据库、内容仓库、S3 是三类独立灾备。

## 7. systemd 自动部署、备份、对账、清理和健康检查

### 前置条件

至少成功执行过一次正式 `install`，或在完成 V2 实例数据准备后执行过 `install --systemd-only`。
五个 timer 都是系统级 unit，但 `User`、`Group`、`WorkingDirectory` 和日志路径来自当前安装用户。

### 启用与验证

```bash
./vinci install --systemd-only # 重新渲染并 enable --now 全部五个 timer；不会迁移 DB 或部署应用
sudo systemctl list-timers --all 'vinci-cms-*' # 查看每个 timer 的 NEXT、LAST 和是否已加载
sudo systemctl status vinci-cms-maintenance-cleanup.timer --no-pager # 自动清理应为 active (waiting)
sudo journalctl -u vinci-cms-maintenance-cleanup.service -n 50 --no-pager # 查看最近清理的脱敏日志
```

正常 `install --initialize=empty|snapshot` 已自动执行第一项，因此首次部署后通常只需后三条验证。
04:00 清理、02:00 备份、03:00 对账和每小时健康检查无需再在 crontab 中配置。清理 service 调用
`maintenance --scheduled`，等价于受保护的 apply：它先要求备份保留门禁成立，并跳过活动镜像、
锁定迁移包和被回滚 marker 引用的版本。

auto-deploy timer 也会安装并处于 waiting，但 `.env` 默认 `AUTO_DEPLOY_ENABLED=false`。完成首次人工
部署和回滚验证后，才用受信任编辑器将它改为 `true`，重新执行 `chmod 600 .env` 和
`./vinci doctor`；之后等待下一次 timer，或用带完整 SHA 的 `./vinci update <40位SHA>` 做受控
人工发布。不要把 `--automatic` 用于人工命令。

### 暂停、恢复与失败处理

```bash
sudo systemctl disable --now vinci-cms-maintenance-cleanup.timer # 临时停止自动清理，不删除历史数据
sudo systemctl enable --now vinci-cms-maintenance-cleanup.timer  # 排障完成后恢复自动清理
./vinci maintenance --dry-run # 恢复前人工确认候选项、保护项和磁盘门禁
```

需要整体重建 unit 时优先重新运行 `./vinci install --systemd-only`，不要手改
`/etc/systemd/system/vinci-cms-*`。service 失败时 timer 通常仍是 active；先查对应 service 的
`systemctl status` 与 `journalctl`，修复后手动执行统一入口验证。失败不是删除 marker、放宽路径
校验或 system-wide prune 的理由。

## 8. 蓝绿部署、回滚、日志和镜像清理

### 前置条件

目标 SHA 是当前线上后继且属于 origin/main；两镜像存在；工作树无跟踪改动；migration 为
expand/contract。

### 命令

```bash
./vinci update <40位SHA>                    # 部署指定且已发布镜像的完整 SHA，便于可重复发布和回滚
./vinci status                              # 核对新 SHA、活动 slot、容器和 gateway 状态
./vinci doctor                              # 运行部署后 DB、HTTP、内容/S3、timer 和磁盘复验
./scripts/cleanup-deploy-cache.sh --dry-run # 只列可清理镜像/缓存及保护原因，不实际删除
```

人工发布推荐总是传完整 SHA。`./vinci update` 不带 SHA 时会读取远端 `origin/main` 的最新 SHA，
因此会发生网络 Fetch；`--automatic` 只供已安装的 auto-deploy timer 调用，不作为人工发布参数。

### 预期与验证

按缓存清理→拉镜像→Migration→非活动槽健康→gateway reload 顺序执行，原子更新状态。清理
保留所有容器引用、活动/失败 marker、`.deploy/rollback-verified` 指向的上一健康版本，且每仓库
至少保留最近 3 个 SHA；即使回滚版本超过最近数量也不得删除。

### 失败处理、回滚与安全

候选失败保留旧槽，不循环重试同失败 SHA。查看轮转日志、Compose、候选 health 和 Migration。
用新修复 Commit 或普通 `git revert` 后重新部署；不直接覆盖容器、改 gateway 状态或 down。
日志按日/30 份/100 MiB 轮转且须脱敏；禁止 system/volume prune 和强删引用镜像。

## 9. 内容仓库、异步导出、03:00 对账和重试

### 前置条件

唯一内容仓库/main 与首次复制均存在；凭据最小化；workspace 和代码根分离。首次接管必须先按
阶段 6 手册 Dry Run 并由维护者确认。

### 命令

```bash
./vinci doctor                # 只读汇总 pending/failed 内容任务、最近对账和 PR 状态
./vinci reconcile             # 立即执行一次 DB→内容仓库对账；可能产生普通 Commit/Push
```

`reconcile` 会写独立内容仓库，运行前确认凭据、远端和 workspace 都是目标环境；失败 Outbox 在
CMS 中逐项明确手动重试。`--scheduled` 只供 03:00 timer 使用，人工命令不需要填写。

### 预期与验证

数据库 Revision/Outbox 先提交，前台立即生效；Worker 普通 Commit 三类 Markdown 和 metadata；
03:00 从数据库修正受管路径，无差异不 Commit。doctor 汇总 pending/failed job、最近对账和 PR。

### 失败处理、回滚与安全

远端失败不回滚数据库；保留 job/run/error code。非快进、脏 workspace、symlink/未知文件时停写
并做只读报告。可停 Worker/timer，仓库错误用普通 revert 或 DB 对账纠正；不 reset/Force Push。
内容仓库不能覆盖非空数据库；PR 只建草稿/提案，不自动 Merge/批准/发布。

## 10. 灾难恢复

### 前置条件

先区分数据库、内容仓库、S3/COS。首选最新 `.vinci-verified` dump；内容 snapshot 仅在完整 dump
不可用时恢复公开内容；对象从 Bucket 版本/复制恢复。

### 命令

数据库完整恢复按第 4/5 节。最后手段：

```bash
./scripts/content-disaster-recovery.sh dry-run /绝对/快照 <维护者标识>
# 核对后在隔离空库提供上一轮精确确认值再执行 apply
```

第一条命令只校验并生成报告/确认值；`<维护者标识>` 填可审计但不含秘密的账号标识。

### 预期与验证

格式/路径/ID/hash/引用通过；事务导入、后置 Migration、pointer/hash 和 loopback HTTP 通过。
snapshot 无法恢复用户/草稿/完整历史/审核/审计，不能猜测补齐。

### 失败处理、回滚与安全

任一校验失败停止；事务后失败保留整个隔离库，从新空库重演。切换前保留旧流量；内容仓库
纠正用普通 Commit，业务内容回滚用新 Revision。演练不连生产库，不把 URL/令牌交给验收者，
确认值绑定 mode、snapshot 和报告，且没有非空 override。

## 11. FAQ 与高级排障

### 前置条件与命令

```bash
./vinci status     # 只读获取时间、SHA、slot、Compose、timer 和最近成功备份
./vinci doctor     # 只读执行跨 DB、内容、S3/COS、容器、gateway 和磁盘的诊断
```

记录时间、SHA、slot、timer、run ID 和脱敏错误码；不要附带 `.env` 或完整容器环境。

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
