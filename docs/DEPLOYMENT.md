# Docker、自动部署、备份、恢复与迁移教程

本文是阶段 8 的操作手册。它既说明“该做什么”，也说明“为什么做、在哪里做、做完应看到什么”。

所有首次演练必须使用测试服务器、测试数据库、测试 S3 Bucket 和测试 GitHub 仓库或 fork。不要把真实生产数据库、生产对象存储或现有正常数据当作练习目标。

## 1. 先选择你要看的教程

| 教程 | 用途 | 什么时候使用 | 是否影响线上访问 |
| --- | --- | --- | --- |
| 教程一：理解运行架构 | 认识容器、数据和两条发布通道 | 第一次部署前 | 不执行操作 |
| 教程二：准备一台 Linux 服务器 | 安装依赖、克隆代码、准备密钥和 `.env` | 新服务器首次接入 | 尚未上线时无影响 |
| 教程三：完成首次上线 | 建库、迁移、启动蓝绿槽位和创建管理员 | 新服务器准备完成后 | 新站无影响；旧单容器升级可能短暂中断 |
| 教程四：接通 GitHub Actions | 本机 push `main` 后自动构建并 SSH 部署 | 首次上线前后各配置一次 | 配置本身无影响 |
| 教程五：发布 Markdown | 只改 `content/**`，走内容发布通道 | 日常编辑内容 | 设计目标是无可见停机 |
| 教程六：发布 Vue/代码 | 代码、配置、依赖或 migration 走完整通道 | 开发功能或修复代码 | 普通兼容改动也蓝绿切换；不兼容数据库改动需维护窗口 |
| 教程七：日常检查与排障 | 查看当前 commit、活动槽位、健康和日志 | 发布后或站点异常时 | 只读检查无影响 |
| 教程八：创建和检查备份 | 备份 PostgreSQL 和 CMS Git 异常状态 | 定时任务和重大变更前 | 通常不停机 |
| 教程九：隔离恢复演练 | 证明备份真的能恢复，同时不碰正常数据 | 上线前及定期演练 | 使用隔离项目，不影响线上 |
| 教程十：迁移到新服务器 | 把数据库和服务器配置迁到全新 Linux | 更换主机或灾难恢复 | 最终一致性切换会有维护窗口 |
| 教程十一：失败与回滚 | 候选版本失败、功能回归、迁移失败时处理 | 故障时 | 视故障类型而定 |

教程二的第 3.5 节另有一份可选教程：允许个人账号通过 VS Code 读写整个部署目录。默认不需要执行；只有明确接受误改部署工作区的风险时才启用。

如果你的问题是“本机提交后服务器会不会自动更新”，直接看教程四。答案是：**只在 commit 被 push 到 GitHub 的 `main`、工作流全部通过、生产环境审批已完成时，服务器才会自动部署；仅本地 commit 不会触发任何服务器操作。**

第一次上线的推荐阅读和操作顺序是：

1. 读教程一，理解哪些数据不能删除；
2. 按教程二把服务器准备到“尚未启动应用”的状态；
3. 按教程四第 5.2～5.4 节先接通 Actions SSH 和 Secrets；
4. push 第一个阶段 8 `main` commit，让 Actions 发布两种镜像并自动执行首次 `application` 部署；
5. 回到教程三第 4.4～4.5 节创建管理员并验收；
6. 再分别按教程五、六测试内容通道和完整应用通道。

教程三第 4.3 节提供的是“镜像已经发布，但需要人工完成首次部署”时的等价命令。不要在镜像尚未发布时运行它。

## 2. 教程一：理解运行架构

### 2.1 这个教程是做什么的

这部分帮助你判断哪些东西可以重建，哪些东西必须备份，以及为什么 Markdown 和 Vue 改动会走不同通道。

### 2.2 一次请求经过哪些组件

```text
公网 HTTPS
    |
宿主机 Caddy / Nginx（HTTPS 证书）
    |
127.0.0.1:3000
    |
gateway（常驻 Caddy 容器）
    |
app-blue 或 app-green（当前活动槽位）
    |
PostgreSQL / GitHub / S3
```

- `gateway` 是稳定入口，只绑定宿主机回环地址，公网不能直接访问它。
- `app-blue` 和 `app-green` 是两个应用槽位。发布时先更新非活动槽位，健康后让网关 graceful reload 到新槽位。
- `.deploy/current` 记录当前 commit、镜像、活动槽位和发布模式。
- PostgreSQL 只在 Compose 内部网络开放，不映射宿主机端口。
- 宿主机 Caddy 或 Nginx 负责公网域名和 HTTPS，不属于本项目的容器网关。

不要手工编辑 `.deploy/current` 或容器内 `/config/Caddyfile`。它们是部署脚本判断当前状态和安全切换的依据。

### 2.3 数据分别保存在哪里

| 数据 | 权威来源 | 本机持久化 | 如何保护 |
| --- | --- | --- | --- |
| Vue、TypeScript、配置、migration | GitHub | 部署仓库 | GitHub 历史和分支保护 |
| 正式 Markdown | 同一 GitHub 仓库的 `content/` | 进入每个 runtime 镜像 | GitHub 历史；发布时重新构建 |
| 用户、会话、草稿、审核、审计、发布记录 | PostgreSQL | `postgres_data` volume | `pg_dump` 备份和恢复演练 |
| 图片二进制 | S3 兼容对象存储 | 不保存在应用容器 | Bucket 版本控制、复制或供应商备份 |
| CMS 发布工作区 | GitHub 的临时工作副本 | `cms_git_worktree` volume | GitHub 为主；备份额外保存异常 commit/patch |
| 网关活动路由 | 部署脚本 | `gateway_config` volume | 可由部署重新建立 |
| `.env`、SSH 私钥、真实 `known_hosts` | 加密密码库 | 宿主机文件 | 独立加密备份，不进入 Git |

Docker 镜像不是数据库备份。删除 `postgres_data` 会删除数据库；重建 runtime 容器则不应删除数据库。

### 2.4 两条自动发布通道

纯内容通道满足一个严格条件：这个 push 中的所有变化都在 `content/**`。它会：

1. 运行测试、类型检查和 production build；
2. 构建包含新 Markdown 的 runtime 镜像；
3. 跳过 operations 镜像和数据库 migration；
4. 在非活动槽位启动新镜像；
5. 健康后无可见停机切换网关。

完整应用通道用于任何 `content/` 外的变化，包括 Vue、TypeScript、依赖、配置、Docker、workflow 和 migration。混合修改也属于完整应用通道。它会额外构建 operations 镜像并执行 migration，然后进行相同的蓝绿切换。

Nuxt Content 在构建期生成索引和预渲染页面，所以 Markdown 不能只复制到正在运行的容器。这里的“无中断内容发布”指重新构建不可变镜像并蓝绿切换，不是热改容器文件。

普通 Vue 改动并不必然停机。只有破坏旧版本兼容性的数据库结构变更，才可能需要明确维护窗口。数据库变更应优先使用 expand/contract：

1. 先新增兼容字段或表；
2. 部署同时兼容旧、新结构的代码；
3. 完成数据回填；
4. 确认旧代码不再使用旧结构后，再在后续版本删除。

## 3. 教程二：准备一台 Linux 服务器

### 3.1 这个教程是做什么的

它把一台干净 Linux 主机准备成可被 GitHub Actions 部署的目标。下面命令均在**服务器**执行，除非步骤明确写“管理电脑”或“GitHub”。

示例目录是 `/opt/vinci-cms`，域名、账号、仓库地址和凭据全部使用你自己的测试值。不要把示例占位符直接用于生产。

### 3.2 安装并确认基础工具

安装 Docker Engine、Docker Compose plugin、Git 和 `curl`。安装方式随 Linux 发行版变化，应使用 Docker 和发行版的官方安装说明。安装后运行：

```bash
docker --version
docker compose version
git --version
curl --version
```

目的：确认后续脚本依赖的命令都存在。

预期：四条命令都打印版本并以状态码 0 退出。

如果当前账号执行 `docker ps` 报权限错误，先把专用部署账号配置为可运行 Docker，再重新登录。不要用在 GitHub Secrets 中保存 root 密码的方式解决。

### 3.3 创建专用部署账号和目录

推荐使用专用账号 `vinci-deploy`。不能直接执行带
`-o vinci-deploy -g vinci-deploy` 的 `install`：系统必须先存在这个用户和用户组，否则会出现：

```text
install: invalid user 'vinci-deploy'
```

#### 3.3.1 确认账号是否已经存在

```bash
getent passwd vinci-deploy
```

目的：查询系统账号数据库，不创建或修改任何用户。

预期：

- 如果打印以 `vinci-deploy:` 开头的一行，说明账号已经存在，跳到第 3.3.3 节；
- 如果没有输出且返回非零状态，说明需要先创建账号。

#### 3.3.2 创建账号

Debian 或 Ubuntu 执行：

```bash
sudo adduser --disabled-password --gecos '' vinci-deploy
```

目的：

- 创建 `vinci-deploy` 用户；
- 同时创建同名主用户组；
- 创建 `/home/vinci-deploy`；
- 不启用密码登录，后续自动部署使用 SSH 公钥。

其他使用 `useradd` 的 Linux 发行版可以执行：

```bash
sudo useradd \
  --create-home \
  --shell /bin/bash \
  vinci-deploy
```

两组命令只选符合当前发行版的一组，不要重复执行。创建后检查：

```bash
getent passwd vinci-deploy
id vinci-deploy
```

预期：能看到用户、主用户组和 `/home/vinci-deploy`。

#### 3.3.3 允许部署账号运行 Docker

先确认 Docker 用户组存在：

```bash
getent group docker
```

正常的 Docker Engine 安装通常会打印以 `docker:` 开头的一行。如果没有输出，应先检查 Docker Engine 是否按官方方式完整安装，不要继续配置 Actions。

把部署账号加入 Docker 组：

```bash
sudo usermod -aG docker vinci-deploy
```

目的：让 GitHub Actions 通过该账号运行 `docker compose`，不需要把 sudo 密码放进 GitHub Secrets。

Docker 组成员通常可以获得接近 root 的宿主机控制能力，因此只能加入受信任的专用部署账号，不能把它当作低权限组。

启动一个新的登录会话验证组权限：

```bash
sudo -iu vinci-deploy id
sudo -iu vinci-deploy docker ps
```

预期：

- `id` 输出的组列表中包含 `docker`；
- `docker ps` 能列出容器或空列表，不出现 `permission denied`。

如果第一条没有 `docker`，确认 `usermod` 成功后退出旧会话，再创建新的登录会话。如果第二条仍失败，检查 Docker 服务：

```bash
sudo systemctl status docker --no-pager
```

不要通过把 root 密码保存到 GitHub Secrets、给 Docker socket 设置全员可写权限，或让部署脚本执行交互式 sudo 来绕过错误。

#### 3.3.4 创建部署和备份目录

账号和 Docker 权限验证完成后，再创建目录：

```bash
sudo install -d -o vinci-deploy -g vinci-deploy -m 0750 /opt/vinci-cms
sudo install -d -o vinci-deploy -g vinci-deploy -m 0700 /var/backups/vinci-cms
```

目的：

- `/opt/vinci-cms` 保存只读式部署 clone；
- `/var/backups/vinci-cms` 保存数据库备份，必须位于项目目录之外；
- 专用账号限制自动部署的权限范围。

预期：

```bash
ls -ld /opt/vinci-cms /var/backups/vinci-cms
```

显示：

- 两个目录的 owner 和 group 都是 `vinci-deploy`；
- `/opt/vinci-cms` 权限为 `drwxr-x---`；
- `/var/backups/vinci-cms` 权限为 `drwx------`。

### 3.4 克隆部署仓库

先切换到刚创建的部署账号：

```bash
sudo -iu vinci-deploy
whoami
```

预期 `whoami` 输出 `vinci-deploy`。然后执行：

```bash
git clone https://github.com/SDUTVINCI/sdutvinci_web.git /opt/vinci-cms
cd /opt/vinci-cms
git remote get-url origin
git status --short --branch
```

目的：建立服务器部署 clone。这个目录只供 Actions 和部署脚本使用，不能与 CMS 后台发布 Markdown 的工作区混用。

即使当前登录账号已经在 `~/my/sdutvinci_web` 有一个开发 clone，也不要把它直接复制或改名成部署目录；继续使用独立的 `/opt/vinci-cms` clone。

预期：

- `origin` 打印预期仓库 URL；
- 工作区没有本地改动；
- 当前分支是 `main`，或后续由部署脚本切换到目标 commit。

如果仓库是私有的，还必须为部署账号配置只读拉取权限，并保证无人值守的 `git fetch origin main` 能成功。该凭据只负责服务器部署 clone 的读取；不要因此扩大 Actions SSH key 或 CMS 发布 key 的权限范围。

不要在此目录手工编辑代码或 Markdown。部署脚本发现已跟踪文件改动时会拒绝覆盖。

### 3.5 可选教程：允许个人账号通过 VS Code 读写整个部署目录

#### 3.5.1 这个可选教程是做什么的

默认情况下：

- `/opt/vinci-cms` 由 `vinci-deploy` 拥有；
- GitHub Actions 直接以 `vinci-deploy` 部署；
- 个人账号 `tungchiahui` 负责 SSH、sudo 和服务器管理；
- 项目源码应在 `~/my/sdutvinci_web` 等开发 clone 中修改。

如果你希望 VS Code Remote SSH 仍以 `tungchiahui` 登录，但能读写 `/opt/vinci-cms` 中的全部文件，可以使用 ACL 单独授权。ACL 不改变文件 owner，`vinci-deploy` 和自动部署仍可正常使用该目录。

这是可选方案。它适合需要用 VS Code 查看和维护服务器文件的管理员，但会增加以下风险：

- VS Code 自动格式化可能修改 Git 跟踪文件；
- 扩展可能创建配置或缓存文件；
- 任何已跟踪文件改动都会让部署脚本拒绝继续；
- `tungchiahui` 将能读取 `.env` 中的数据库、CMS 和 S3 凭据。

如果只需要修改 `.env`，更安全的做法是只给 `.env` 单独添加 ACL，不开放整个仓库。

#### 3.5.2 回到个人管理账号

如果当前提示符是 `vinci-deploy@...`，先退出：

```bash
exit
whoami
```

预期 `whoami` 输出：

```text
tungchiahui
```

目的：安装软件和修改 ACL 属于服务器管理操作，应使用有 sudo 权限的个人账号完成。`vinci-deploy` 使用 `--disabled-password` 创建，没有可用于交互式 sudo 的密码，这是预期设计。

#### 3.5.3 安装 ACL 工具

Debian 或 Ubuntu 执行：

```bash
sudo apt update
sudo apt install -y acl
command -v setfacl
command -v getfacl
```

目的：安装按单个用户授权的 `setfacl` 和检查权限的 `getfacl`。

预期：最后两条命令分别打印可执行文件路径。

#### 3.5.4 给现有文件和未来文件授权

确认目标是部署目录后执行：

```bash
realpath /opt/vinci-cms
sudo setfacl -R \
  -m u:tungchiahui:rwX \
  /opt/vinci-cms
sudo find /opt/vinci-cms -type d \
  -exec setfacl -m d:u:tungchiahui:rwX {} +
```

两条 ACL 命令作用不同：

1. 第一条给目录内已经存在的文件和目录添加 `tungchiahui` 权限；
2. 第二条给所有目录添加默认 ACL，使以后由 `vinci-deploy`、Git 或部署脚本创建的文件继续继承权限。

这里的 `X` 只给目录和原本可执行的文件增加执行权限，不会把普通文本文件变成可执行文件。

不要把目标换成 `/`、`/opt` 或其他宽泛目录，也不要使用 `chmod -R 777`。

#### 3.5.5 验证 ACL

```bash
getfacl -p /opt/vinci-cms | sed -n '1,30p'
touch /opt/vinci-cms/.vinci-permission-check
rm -- /opt/vinci-cms/.vinci-permission-check
```

预期：

- ACL 中有 `user:tungchiahui:rwx`；
- 有 `default:user:tungchiahui:rwx`；
- `touch` 和 `rm` 都成功。

这个临时文件只用于验证写权限，命令随后会立即删除它。

#### 3.5.6 允许 VS Code 的 Git 功能信任确切目录

因为仓库 owner 是 `vinci-deploy`，Git 可能提示 `detected dubious ownership`。先确认目录确实是预期部署 clone：

```bash
git -C /opt/vinci-cms remote get-url origin
ls -ld /opt/vinci-cms /opt/vinci-cms/.git
```

确认无误后，以 `tungchiahui` 执行：

```bash
git config --global --add safe.directory /opt/vinci-cms
git -C /opt/vinci-cms status --short --branch
```

目的：只信任这个确切路径，不使用通配符信任所有其他用户拥有的仓库。

#### 3.5.7 在 VS Code 中打开

1. VS Code 安装 `Remote - SSH` 扩展；
2. SSH 配置继续使用 `User tungchiahui`；
3. 连接服务器；
4. 选择 `File → Open Folder`；
5. 输入 `/opt/vinci-cms`；
6. 打开终端，运行 `whoami`，确认仍是 `tungchiahui`；
7. 运行 `git status --short --branch`，确认仓库初始状态干净。

不要为了 VS Code 直接登录而给 `vinci-deploy` 设置密码。GitHub Actions 使用的专用 SSH 公钥与 VS Code 人工登录无关。

#### 3.5.8 `.env` 的特殊处理

后面的第 3.6 节会执行：

```bash
chmod 600 .env
```

`chmod 600` 可能收紧 ACL mask，因此创建并保护 `.env` 后，再以 `tungchiahui` 执行一次：

```bash
sudo setfacl \
  -m u:tungchiahui:rw \
  /opt/vinci-cms/.env
getfacl -p /opt/vinci-cms/.env
```

预期能看到 `user:tungchiahui:rw-`，且 ACL 的 `mask` 没有移除这项有效权限。除 `root`、`vinci-deploy` 和明确授权的 `tungchiahui` 外，其他用户仍不能读取 `.env`。

如果使用 1Panel 文件管理器保存 `.env`，保存后还要检查：

```bash
sudo chown vinci-deploy:vinci-deploy /opt/vinci-cms/.env
sudo chmod 600 /opt/vinci-cms/.env
sudo setfacl -m u:tungchiahui:rw /opt/vinci-cms/.env
```

因为某些网页文件管理器采用“创建新文件后替换旧文件”的保存方式，可能改变 owner 或清除原 ACL。

#### 3.5.9 每次自动部署前检查

在 `/opt/vinci-cms` 中执行：

```bash
git status --short --untracked-files=no
git diff --check
```

预期两条命令均没有输出。第一条只检查已跟踪文件，因为 `.env` 和服务器状态文件不属于 Git。

如果有输出：

1. 停止本次部署；
2. 用 `git diff` 审查具体改动；
3. 需要保留的源码改动移回开发 clone，正常 commit 并 push；
4. 只有确认部署 clone 中的改动不需要保留后，才恢复对应的确切文件；
5. 不要直接对整个仓库运行 `git reset --hard`。

部署 clone 即使具备写权限，也不应成为日常代码开发目录。

#### 3.5.10 撤销整个目录的个人写权限

如果以后不再需要 VS Code 写入，可以移除这一个用户的 ACL：

```bash
sudo setfacl -R \
  -x u:tungchiahui \
  /opt/vinci-cms
sudo find /opt/vinci-cms -type d \
  -exec setfacl -x d:u:tungchiahui {} +
git config --global --unset-all safe.directory /opt/vinci-cms
```

目的：只删除 `tungchiahui` 的访问 ACL 和 Git 信任项，不改变 owner，也不删除其他用户可能存在的 ACL。

撤销后重新检查：

```bash
getfacl -p /opt/vinci-cms | sed -n '1,30p'
git -C /opt/vinci-cms status --short --branch
```

如果只想保留 `.env` 编辑权限，可在撤销整个目录 ACL 后，单独重新添加：

```bash
sudo setfacl \
  -m u:tungchiahui:rw \
  /opt/vinci-cms/.env
```

### 3.6 创建 `.env`

```bash
cd /opt/vinci-cms
cp .env.example .env
chmod 600 .env
```

使用只在服务器上的编辑器修改 `.env`。它不会进入 Git。重要变量如下：

| 变量 | 作用 | 填写规则 |
| --- | --- | --- |
| `COMPOSE_PROJECT_NAME` | Compose 资源隔离名 | 同一主机必须唯一，例如 `vinci-cms` |
| `APP_IMAGE` | runtime 镜像 | `ghcr.io/组织/仓库` |
| `APP_OPS_IMAGE` | migration/admin 镜像 | 通常是 runtime 名加 `-ops` |
| `APP_IMAGE_TAG` | 人工 Compose 命令的默认 tag | 首次可保留 `local`；自动部署会用完整 SHA 覆盖 |
| `APP_BIND_ADDRESS` | 宿主机监听地址 | 保持 `127.0.0.1` |
| `APP_PORT` | 宿主机反代到的端口 | 默认 `3000`，同机多项目必须不同 |
| `NUXT_PUBLIC_SITE_URL` | 网站公开地址 | 使用完整 `https://...` |
| `POSTGRES_*` | 容器内数据库初始化身份 | 使用独立强随机密码 |
| `DATABASE_URL` | 应用访问正常数据库 | host 必须是 `postgres` |
| `TEST_DATABASE_URL` | 集成测试专用数据库 | 不得指向正常数据库；数据库名需有独立 `test` 片段 |
| `CMS_AUTH_SECRET` | session 签名 | 至少 32 个随机字节，不能更换丢失 |
| `CMS_GIT_*` | CMS 向 GitHub 提交 Markdown | remote、branch、作者和密钥路径 |
| `S3_*` | 图片存储 | 使用目标环境对应的 Bucket；首次演练必须是测试 Bucket |
| `DEPLOY_GIT_REMOTE_URL` | 防止部署错仓库 | 必须与 `git remote get-url origin` 完全一致 |
| `BACKUP_ROOT` | 备份根目录 | 项目外的绝对路径，不能是 `/` |

可生成两个不同的随机值：

```bash
openssl rand -base64 48
openssl rand -hex 32
```

一个可用作 `CMS_AUTH_SECRET`，另一个可用作数据库密码。不要把命令输出复制到聊天、Issue、日志或 Git。若数据库密码含 URL 特殊字符，`DATABASE_URL` 中必须使用 URL 编码后的密码，而 `POSTGRES_PASSWORD` 使用原值。

保存后只检查配置能否解析，不打印真实值：

```bash
docker compose config --quiet
```

预期：没有输出并返回成功。不要执行 `docker compose config` 后把完整输出粘贴到公开位置，因为展开后的配置可能包含凭据。

### 3.7 准备 CMS 登录 GitHub 的密钥

这把密钥的方向是：

```text
服务器中的 CMS -> GitHub 仓库
```

它用于后台发布 Markdown，需要对**这一个仓库**有写权限。它不是 Actions 登录服务器的密钥。

在服务器执行：

```bash
sudo install -d -o vinci-deploy -g vinci-deploy -m 0700 /etc/vinci-cms
sudo -u vinci-deploy ssh-keygen \
  -t ed25519 \
  -f /etc/vinci-cms/cms_git_deploy_key \
  -N '' \
  -C 'vinci-cms-publisher'
sudo chmod 600 /etc/vinci-cms/cms_git_deploy_key
sudo chmod 644 /etc/vinci-cms/cms_git_deploy_key.pub
```

目的：生成只供 CMS 发布使用的仓库级密钥。

然后：

1. 只复制 `.pub` 文件内容；
2. 在 GitHub 目标仓库添加 Deploy Key；
3. 为它启用写权限，因为 CMS 要 commit 并 push；
4. 私钥始终留在服务器并另存到加密密码库。

不要把私钥添加到 GitHub Deploy Key，也不要提交到仓库。

再准备固定的 GitHub host key：

```bash
ssh-keyscan -t ed25519 github.com \
  > /etc/vinci-cms/github_known_hosts.candidate
ssh-keygen -lf /etc/vinci-cms/github_known_hosts.candidate
```

目的：防止 CMS SSH 连接被中间人冒充。

必须从可信渠道取得 GitHub 公布的 SSH fingerprint，人工比较后才能执行：

```bash
mv /etc/vinci-cms/github_known_hosts.candidate \
  /etc/vinci-cms/github_known_hosts
chmod 644 /etc/vinci-cms/github_known_hosts
```

在 `.env` 填写：

```dotenv
CMS_GIT_SSH_KEY_FILE=/etc/vinci-cms/cms_git_deploy_key
CMS_GIT_KNOWN_HOSTS_FILE=/etc/vinci-cms/github_known_hosts
CMS_GIT_REMOTE_URL=git@github.com:SDUTVINCI/sdutvinci_web.git
```

Compose 会把宿主机文件只读挂载到应用容器。文件必须真实存在，不能用 `/dev/null` 代替。

### 3.8 登录私有 GHCR

#### 3.8.1 这个教程是做什么的

GitHub Actions 会把两个镜像发布到 GitHub Container Registry：

```text
ghcr.io/sdutvinci/sdutvinci_web
ghcr.io/sdutvinci/sdutvinci_web-ops
```

- runtime package 用于 `app-blue` 和 `app-green`；
- operations package 用于数据库 migration 和首个管理员命令。

服务器只需要拉取镜像，不需要上传、删除或管理 package。因此如果必须登录，只授予 `read:packages`。

GitHub 仓库公开不等于 GHCR package 一定公开。Container Registry 的 package 可见性可以单独设置，必须分别检查两个 package。

#### 3.8.2 先决定使用公开还是私有 package

有两种方案，只选一种。

方案 A：两个 package 都设为 Public。

- 服务器可以匿名拉取；
- 不创建或保存 Personal Access Token；
- 可以完全跳过本节后面的登录步骤；
- package 设为 Public 后通常不能再改回 Private。

第一次 `main` push 创建 package 后，在 GitHub 组织中分别打开 `sdutvinci_web` 和 `sdutvinci_web-ops`：

1. 进入 package 页面；
2. 打开 `Package settings`；
3. 找到 `Change visibility`；
4. 确认镜像可以公开后选择 `Public`；
5. 两个 package 都要单独检查。

源码仓库公开并不自动替你完成这一步。修改 package 可见性属于外部且可能不可逆的操作，必须由仓库维护者人工确认。

首次 `main` push 时，Actions 可能已经成功发布镜像，但部署 job 因 package 初始为 Private 而在服务器 `docker pull` 失败。这不会修改数据库。把两个 package 都确认设为 Public 后，可以重新运行该次失败的 workflow；不要为此删除容器或 volume。

方案 B：package 保持 Private。

- 服务器需要登录 GHCR；
- 使用个人 GitHub 账号创建只读 Personal Access Token；
- token 长期保存在 `vinci-deploy` 的 Docker credential 文件中；
- token 到期、被撤销或失去 package 权限后，新部署将无法拉取镜像。

GitHub 关于 package 可见性和权限的官方说明：

- [配置 package 访问权限和可见性](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility)
- [GitHub Packages 权限说明](https://docs.github.com/en/packages/learn-github-packages/about-permissions-for-github-packages)

#### 3.8.3 创建只读 Personal Access Token

token 在有权读取组织 package 的**个人 GitHub 账号**中创建，不是在组织账号中创建。组织名只出现在镜像地址中，不能作为 `docker login` 的登录身份。

例如：

```text
组织名：SDUTVINCI
个人 GitHub 用户名：tungchiahui
镜像地址：ghcr.io/sdutvinci/sdutvinci_web
docker login 用户名：tungchiahui
```

不需要借用组织拥有者的 token。如果当前个人账号已有 package 读取权限，使用自己的账号即可。长期要求更严格时，可以创建专用 GitHub 机器账号，并只授予 package 读取权限。

在浏览器中：

1. 登录签发 token 的个人 GitHub 账号；
2. 点击右上角头像；
3. 打开 `Settings`；
4. 打开 `Developer settings`；
5. 打开 `Personal access tokens`；
6. 选择 `Tokens (classic)`；
7. 点击 `Generate new token`；
8. 选择 `Generate new token (classic)`；
9. `Note` 填写容易识别的名称，例如 `vinci-server-ghcr-read`；
10. 选择有效期；
11. 权限只勾选 `read:packages`；
12. 点击 `Generate token`；
13. 立即复制到密码管理器。

GitHub Packages 当前要求 Personal Access Token (classic)。不要改用 Fine-grained token，除非 GitHub 官方以后明确支持当前 GHCR 登录场景。

权限只需要：

```text
read:packages
```

不要额外勾选：

```text
repo
write:packages
delete:packages
admin:org
```

有效期选择：

| 有效期 | 优点 | 风险和维护 |
| --- | --- | --- |
| 90 天 | 泄漏后的最长有效时间较短 | 需要定期轮换，过期会导致部署拉取失败 |
| 1 年 | 维护频率较低 | 泄漏后风险窗口更长 |
| No expiration | 不会因自然过期中断部署 | 泄漏后会一直有效，直到人工撤销；组织策略也可能禁止 |

`No expiration` 不是技术上不能选择，而是不作为默认推荐。若选择无期限，必须保持只有 `read:packages`，妥善保护服务器，并定期审核个人账号和 package 权限。

如果 `SDUTVINCI` 启用了 SAML SSO，token 创建后还需要在 token 页面点击 `Configure SSO`，授权访问该组织。若组织策略禁止 classic token 或限制最长有效期，应遵守组织策略，不能绕过。

完整 token 只在创建时显示一次。刷新或关闭页面后无法再次查看，丢失时应撤销旧 token 并重新创建。不要把 token 发送到聊天、Issue、Git、`.env` 或普通备份。

GitHub 官方创建步骤：

- [管理 Personal Access Token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
- [使用 GitHub Container Registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)

#### 3.8.4 以 `vinci-deploy` 登录 GHCR

先看当前身份：

```bash
whoami
```

如果输出 `tungchiahui`，执行：

```bash
sudo -iu vinci-deploy
```

如果已经输出 `vinci-deploy`，不要再次运行 sudo。`vinci-deploy` 使用禁用密码方式创建，也不应加入 sudoers。

使用 token 签发者的个人 GitHub 用户名登录。以下示例表示 token 由 `tungchiahui` 账号创建：

```bash
read -rsp 'GHCR read token: ' ghcr_read_token
printf '\n'

printf '%s' "$ghcr_read_token" \
  | docker login ghcr.io \
      -u 'tungchiahui' \
      --password-stdin

unset ghcr_read_token
```

`read -s` 输入时不会显示字符或星号，这是正常的。不要把 token 直接写在命令行中，否则可能进入 shell history。

预期：显示 `Login Succeeded`。token 不写入 `.env`、仓库或 shell 脚本；实际操作时优先从密码管理器安全粘贴，避免保留在 shell history。

登录信息保存在：

```text
/home/vinci-deploy/.docker/config.json
```

不要打印或复制这个文件的内容。检查 owner 和权限即可：

```bash
ls -l /home/vinci-deploy/.docker/config.json
```

#### 3.8.5 验证两个镜像都能读取

必须先有一次 `main` push 成功发布对应 SHA 镜像。把 Actions 显示的完整 40 位 commit SHA 填入：

```bash
target_commit='替换为已发布的40位commit SHA'

docker manifest inspect \
  "ghcr.io/sdutvinci/sdutvinci_web:${target_commit}" \
  >/dev/null

docker manifest inspect \
  "ghcr.io/sdutvinci/sdutvinci_web-ops:${target_commit}" \
  >/dev/null
```

目的：分别确认 runtime 和 operations 镜像存在且当前账号可以读取，不启动容器。

预期：两条命令都没有输出并成功退出。

- `denied`：package 仍为 Private 且 token、SSO 或 package 权限不正确；
- `manifest unknown`：镜像尚未发布或 SHA 填错；
- runtime 成功但 operations 失败：可能目标 commit 被分类为 `content`，该模式本来不会构建 operations 镜像；首次部署必须选择一个已构建 operations 的 `application` commit。

若选择 Public package，可以在没有执行 `docker login` 的账号或临时空 Docker 配置下完成同样检查，以证明匿名读取有效。

#### 3.8.6 轮换、撤销和退出登录

token 到期前：

1. 创建新的只读 token；
2. 重新执行 `docker login`，覆盖服务器保存的登录信息；
3. 验证两个镜像可读取；
4. 在 GitHub 删除旧 token。

如果以后把两个 package 都设为 Public，不再需要服务器凭据，可以执行：

```bash
docker logout ghcr.io
```

然后到个人 GitHub 的 `Settings → Developer settings → Personal access tokens → Tokens (classic)` 删除旧 token。

不要只删除服务器上的 Docker 配置而保留无人使用的长期 token；撤销动作必须在 GitHub 完成。

### 3.9 配置宿主机 HTTPS

项目内 `gateway` 只监听 `127.0.0.1:3000`，还需宿主机反向代理把公网 HTTPS 转发到它。例如宿主机 Caddy 的站点逻辑是：

```caddyfile
cms.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

目的：让公网流量经过证书终止后进入稳定网关，同时不暴露应用槽位和 PostgreSQL。

在首次启动站点前可以先保存配置；DNS、证书和防火墙应按服务器环境配置。不要把 PostgreSQL 5432 端口开放到公网。

## 4. 教程三：完成首次上线

### 4.1 这个教程是做什么的

它把某个已经由 Actions 发布到 GHCR 的完整 commit 部署为第一版，并创建首个管理员。

首次目标必须是 `application` 模式，因为此时还没有旧活动槽位。以下命令在服务器的 `/opt/vinci-cms` 执行。

### 4.2 上线前检查

```bash
cd /opt/vinci-cms
git status --short --branch
git remote get-url origin
docker compose config --quiet
test -r /etc/vinci-cms/cms_git_deploy_key
test -r /etc/vinci-cms/github_known_hosts
```

目的：在任何数据库写入前确认仓库、配置和密钥文件都正确。

预期：

- Git 工作区无已跟踪改动；
- remote 与 `.env` 的 `DEPLOY_GIT_REMOTE_URL` 完全一致；
- Compose 配置检查成功；
- 两个密钥文件可读。

### 4.3 使用不可变 commit 首次部署

先确认目标 commit 的 runtime 和 operations 镜像都已由一次 `main` push 发布。将 40 位 SHA 放进变量：

```bash
cd /opt/vinci-cms

git fetch origin main

target_commit="$(
  git rev-parse origin/main
)"

printf '准备部署：%s\n' "$target_commit"
```

检查该 commit 属于远端 `main`：

```bash
git fetch --prune origin main
git cat-file -e "${target_commit}^{commit}"
git merge-base --is-ancestor "$target_commit" origin/main
```

然后执行：

```bash
DEPLOY_COMMIT="$target_commit" \
DEPLOY_MODE=application \
APP_IMAGE=ghcr.io/sdutvinci/sdutvinci_web \
APP_OPS_IMAGE=ghcr.io/sdutvinci/sdutvinci_web-ops \
APP_IMAGE_TAG="$target_commit" \
./scripts/deploy.sh
```

这一步依次完成：

1. 校验仓库、branch、commit 和镜像 tag；
2. 启动 PostgreSQL；
3. 拉取 operations 镜像并执行 migration；
4. 拉取 runtime 镜像到 `app-blue`；
5. 等待候选应用健康；
6. 启动 gateway 并指向健康槽位；
7. 写入 `.deploy/current`。

预期末行类似：

```text
部署成功：<commit>（application，活动槽位 blue）
```

如果失败，不要删除 volume 或修改状态文件。先看教程十一。

### 4.4 创建首个管理员

读取当前线上 SHA，并用对应 operations 镜像启动交互命令：

```bash
current_commit="$(
  awk -F= '$1 == "commit" { print $2; exit }' .deploy/current
)"
APP_IMAGE_TAG="$current_commit" \
docker compose --profile tools run --rm admin
```

目的：只在数据库没有管理员时创建第一个管理员。

预期：命令提示输入管理员信息；已有管理员时会拒绝重复初始化。不要把密码放进命令行参数或文档。

### 4.5 验证首次上线

```bash
docker compose ps
curl --fail http://127.0.0.1:3000/api/health
sed -n '1,20p' .deploy/current
docker compose logs --tail=100 gateway app-blue app-green postgres
```

逐项确认：

- `postgres`、活动应用槽位和 `gateway` 为 running/healthy；
- 健康接口返回成功；
- `.deploy/current` 有 `commit`、`image`、`slot` 和 `mode=application`；
- 日志没有重复崩溃或数据库连接错误；
- 通过测试域名能登录 CMS、读取内容并访问测试图片。

### 4.6 从旧版单 `app` 容器升级

如果服务器以前运行阶段 8 早期的单 `app` 服务，不要手工先删除它。第一次必须走 `application`：

1. 脚本先让候选蓝/绿槽位通过健康检查；
2. 再短暂停止旧 `app`，释放原回环端口；
3. 启动常驻 gateway 并切换；
4. 若 gateway 失败，脚本尝试重启旧容器。

这一次端口交接可能短暂中断。完成后，后续发布均使用双槽位，不再重复这段迁移。

## 5. 教程四：接通 GitHub Actions 自动部署

### 5.1 这个教程是做什么的

它实现下面的链路：

```text
本机 commit
  -> push 到 GitHub main
  -> Actions 测试和构建 commit 镜像
  -> GitHub runner 通过 SSH 登录服务器
  -> scripts/deploy.sh 蓝绿发布
```

注意三个边界：

- 本机只执行 `git commit`：不会触发；
- push 到非 `main` 分支或提交 PR：只验证和构建，不部署生产；
- push 到 `main`：满足工作流条件后自动部署。
- 手工运行 `workflow_dispatch`：只做保守的 `application` 验证和镜像构建检查，不发布镜像，也不 SSH 部署。

如果 GitHub `production` environment 配置了 required reviewers，工作流会停在部署 job 等待批准。批准前不算“完全自动部署”，但镜像构建可以已经完成。

### 5.2 创建 Actions 登录服务器的 SSH 密钥

这把密钥的方向是：

```text
GitHub Actions runner -> Linux 服务器
```

在可信的管理电脑、且不在项目目录内生成：

```bash
ssh-keygen \
  -t ed25519 \
  -f ./vinci_actions_server_deploy \
  -N '' \
  -C 'github-actions-vinci-deploy'
```

把 `.pub` 公钥追加到服务器部署账号的 `~/.ssh/authorized_keys`，并确认权限：

```bash
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
```

从管理电脑先人工测试：

```bash
ssh -i ./vinci_actions_server_deploy \
  vinci-deploy@测试服务器地址 \
  'cd /opt/vinci-cms && git status --short --branch'
```

目的：确认 Actions 将使用的账号能 SSH、读取部署目录并运行后续命令。

预期：打印服务器仓库状态，不要求密码。

### 5.3 固定服务器 host key

在可信管理电脑获取候选 key：

```bash
ssh-keyscan -p 22 -t ed25519 测试服务器地址 \
  > ./vinci_server_known_hosts.candidate
ssh-keygen -lf ./vinci_server_known_hosts.candidate
```

通过云控制台、服务器本地终端或其他独立可信通道核对 fingerprint。确认后，这个文件的完整内容才可作为 Secret。

目的：让 Actions 严格确认“连接的是这台服务器”，而不是自动接受未知主机。

服务器重装或 SSH host key 正常轮换后，工作流会安全失败。应重新独立核对并更新 Secret，不能关闭 `StrictHostKeyChecking`。

### 5.4 配置 GitHub `production` environment

在目标仓库创建名为 `production` 的 environment，并配置以下 Secrets：

| Secret | 示例含义 | 获取方式 |
| --- | --- | --- |
| `DEPLOY_HOST` | 服务器域名或 IP | 你的测试服务器地址 |
| `DEPLOY_PORT` | SSH 端口 | 通常 `22` |
| `DEPLOY_USER` | SSH 部署账号 | 例如 `vinci-deploy` |
| `DEPLOY_PATH` | 服务器仓库绝对路径 | `/opt/vinci-cms` |
| `DEPLOY_SSH_PRIVATE_KEY` | Actions 登录服务器的私钥全文 | 上一步生成的无 `.pub` 文件 |
| `DEPLOY_SSH_KNOWN_HOSTS` | 已核对的服务器 host key 全文 | 上一步 candidate 文件 |

这些 Secrets 只负责 GitHub 到服务器。数据库、CMS session、S3 和 CMS Git 凭据仍只留在服务器 `.env` 或密钥文件中。

建议同时配置：

- environment 只允许 `main` 部署；
- 首次演练启用人工审批；
- 验收稳定后，再决定是否取消审批实现 push 后全自动发布。

### 5.5 第一次触发

先确保教程二的服务器准备已完成，再从本机 push 一个经过审核的 `main` commit：

```bash
git status
git log -1 --oneline
git push origin main
```

目的：触发 `.github/workflows/deploy.yml`。

Actions 中应依次看到：

1. `classify`：显示 `content` 或 `application`；
2. `verify`：独立测试 PostgreSQL、CMS tests、类型检查、production build；
3. `build-runtime`：构建并发布 SHA tag runtime；
4. `build-operations`：仅 application 运行；
5. `deploy`：SSH 到服务器并调用部署脚本。

工作流测试只设置 `TEST_DATABASE_URL`，不会使用服务器的正常 `DATABASE_URL`。

部署成功后在服务器核对：

```bash
cd /opt/vinci-cms
git rev-parse HEAD
sed -n '1,20p' .deploy/current
curl --fail http://127.0.0.1:3000/api/health
```

`git rev-parse HEAD`、`.deploy/current` 的 commit 和 GitHub Actions 的 `${GITHUB_SHA}` 应一致。

### 5.6 为什么 Actions 不会随便覆盖服务器

服务器会再次检查：

- 工作区没有已跟踪文件改动；
- `origin` 与 `.env` 的 `DEPLOY_GIT_REMOTE_URL` 完全相同；
- 目标是完整 40 位小写 SHA；
- 目标属于 `origin/main`；
- 目标是当前线上 commit 的后继，不允许倒序或分叉；
- `APP_IMAGE_TAG` 与目标 SHA 完全相同；
- 请求 `content` 时，服务器重新确认所有路径都在 `content/**`。

因此不要 force-push 已上线的 `main`，也不要靠手工修改 `.deploy/current` 绕过检查。

## 6. 教程五：发布 Markdown

### 6.1 这个教程是做什么的

用于只修改同一仓库 `content/` 中 Markdown 的日常发布。它跳过数据库 migration，但仍进行完整验证、构建 runtime 和蓝绿切换。

### 6.2 发布前确认改动范围

在本机执行：

```bash
git status --short
git diff --name-only
git diff --cached --name-only
```

目的：确认本次 commit 的每一个路径都以 `content/` 开头。

如果同时出现 `app/`、`server/`、`package*.json`、配置、脚本或文档等路径，这个 commit 会保守走 `application`。如果你希望内容单独快速发布，应把互不依赖的代码改动放在另一个 commit；不要为了强行分类而遗漏必要文件。

### 6.3 commit 并 push

```bash
git add content/
git commit -m "content: update published pages"
git push origin main
```

目的：让 GitHub 收到一个只含 `content/**` 的 push。

预期：

- `classify` 输出 `content`；
- `build-runtime` 运行；
- `build-operations` 显示 skipped；
- `deploy` 日志显示跳过运维镜像和数据库迁移；
- 候选槽位健康后，网关切换；
- `.deploy/current` 显示 `mode=content`。

### 6.4 检查没有可见中断

正常验收可在另一终端持续请求测试站点：

```bash
while true; do
  date -u +%FT%TZ
  curl --silent --show-error --fail \
    http://127.0.0.1:3000/api/health >/dev/null || echo 'REQUEST_FAILED'
  sleep 1
done
```

目的：观察切换期间入口是否持续健康。

发布完成后按 `Ctrl+C` 停止。预期没有 `REQUEST_FAILED`。这只是健康接口连续性检查，还要打开实际内容页面确认新 Markdown 已进入镜像。

不要对生产站做高频压力式循环；一秒一次只适合短时人工验收。

## 7. 教程六：发布 Vue、TypeScript 和其他代码

### 7.1 这个教程是做什么的

用于任何 `content/` 外变化，包括：

- Vue 页面或组件；
- TypeScript、服务端 API；
- npm 依赖和 lockfile；
- Docker、Compose、Actions、部署脚本；
- 数据库 migration；
- 内容与代码混合 commit。

### 7.2 正常发布

在本机完成开发验证后：

```bash
git status --short
git diff --check
git add app/ server/ package.json package-lock.json
git commit -m "feat: describe the application change"
git push origin main
```

上面的 `git add` 只是路径示例。应只列出本次实际修改且已经审核的文件或目录，不要为了省事把无关改动一起提交。

预期：

- `classify` 输出 `application`；
- verify 全部通过；
- runtime 和 operations 两个镜像都以同一完整 SHA 发布；
- 服务器先执行已审核 migration；
- 非活动槽位健康后再切换网关；
- `.deploy/current` 显示 `mode=application`。

普通 Vue 改动通常不需要停机，因为旧槽位在新槽位健康前继续服务。完整通道表示检查和操作更多，不等于一定停机。

### 7.3 数据库变更的额外要求

migration 在网关切换前执行，此时旧应用仍在服务。因此 migration 必须能与旧应用短时间共存。

以下变更不能直接当作普通零停机发布：

- 立即删除旧应用仍读取的列或表；
- 直接重命名且没有兼容层；
- 给大表加会长时间锁表的操作；
- 数据回填期间新旧代码对同一字段含义不一致。

遇到这些情况，应拆成 expand/contract 多次发布，或明确安排维护窗口。不要依赖自动 rollback 撤销 migration；当前方案只执行向前 migration，不自动执行 down。

## 8. 教程七：日常检查与排障

### 8.1 这个教程是做什么的

用于回答四个问题：当前运行哪个 commit、流量在哪个槽位、容器是否健康、错误出现在哪层。

### 8.2 查看当前部署状态

在服务器执行：

```bash
cd /opt/vinci-cms
sed -n '1,20p' .deploy/current
docker compose ps
curl --fail http://127.0.0.1:3000/api/health
```

`.deploy/current` 示例字段含义：

- `commit`：当前线上 Git SHA；
- `image`：runtime 镜像及 SHA tag；
- `slot`：`blue` 或 `green`；
- `mode`：本次为 `content` 或 `application`。

### 8.3 分层看日志

```bash
docker compose logs --tail=200 gateway
docker compose logs --tail=200 app-blue app-green
docker compose logs --tail=200 postgres
```

用途：

- gateway 日志：入口、反向代理和槽位连接问题；
- app 日志：Nuxt、API、CMS、Git 或 S3 错误；
- postgres 日志：连接、启动和数据库层错误。

需要实时观察时：

```bash
docker compose logs --follow --tail=100 gateway app-blue app-green
```

用 `Ctrl+C` 退出只会停止日志跟随，不会停止容器。

### 8.4 常见现象

| 现象 | 先检查 | 常见原因 |
| --- | --- | --- |
| 公网打不开，本机 health 正常 | 宿主机反代、DNS、防火墙、证书 | 问题在项目 gateway 之前 |
| gateway unhealthy | gateway 日志、活动 app | 活动槽位不可达或配置异常 |
| app unhealthy | app 和 postgres 日志 | 数据库连接或应用启动失败 |
| 镜像 pull denied | `docker login ghcr.io` | 私有 package 未授权或 token 过期 |
| CMS 可编辑但发布失败 | app 日志、CMS Git key/known_hosts | Deploy Key 无写权限或 host key 不匹配 |
| Actions SSH 失败 | Actions key、服务器 authorized_keys、known_hosts | 把两类 SSH 密钥混用了 |
| 部署拒绝工作区不干净 | `git status --short` | 有人在部署 clone 手改了跟踪文件 |
| content 请求被拒绝 | Git diff 和 Actions 日志 | push 中含 `content/` 外变化 |

发现部署 clone 有人工改动时，先识别改动来源并保存证据。不要直接执行 `git reset --hard` 或删除文件。

## 9. 教程八：创建和检查备份

### 9.1 这个教程是做什么的

备份脚本保护 PostgreSQL，并在 CMS Git 工作区已初始化时保存可能尚未 push 的异常状态。它不会复制 S3 图片，也不会把真实凭据写入普通备份。

运行备份通常不需要停止网站，但 `pg_dump` 会消耗 I/O；大数据库应在低峰期执行。

### 9.2 备份前检查目标

```bash
cd /opt/vinci-cms
docker compose ps postgres
test -d /var/backups/vinci-cms
realpath /var/backups/vinci-cms
```

目的：确认 PostgreSQL 正在运行，备份根目录是项目外的明确绝对路径。

脚本还会校验 Compose project label、service label、数据库名和数据库用户，避免备份同机的错误容器。

### 9.3 执行备份

```bash
cd /opt/vinci-cms
./scripts/backup.sh
```

预期末行打印一个新的时间戳目录，例如：

```text
备份完成：/var/backups/vinci-cms/vinci-cms-YYYYMMDDTHHMMSSZ
```

脚本先写临时目录，校验成功后才原子移动为最终目录。它使用操作锁，部署、备份和恢复不能同时执行。

### 9.4 人工检查备份

把下面占位符替换为脚本刚打印的**确切目录**：

```bash
backup_dir='/var/backups/vinci-cms/替换为确切备份目录名'
test -d "$backup_dir"
find "$backup_dir" -maxdepth 1 -type f -printf '%f\n' | sort
(
  cd "$backup_dir"
  sha256sum --check --strict SHA256SUMS
)
docker compose exec -T postgres pg_restore --list \
  < "$backup_dir/postgresql.dump" >/dev/null
sed -n '1,30p' "$backup_dir/manifest.env"
sed -n '1,40p' "$backup_dir/config-checklist.txt"
```

目的：

- `SHA256SUMS` 证明文件未损坏或被替换；
- `pg_restore --list` 证明 dump 格式可读取；
- manifest 确认时间、项目、数据库和仓库 commit；
- checklist 只记录配置项是否存在，不泄露值。

可能出现的 CMS Git 文件：

- `cms-git-refs.bundle`：所有 refs；
- `cms-git-working-tree.patch`：已跟踪文件的未提交差异；
- `cms-git-untracked.tar.gz`：未跟踪文件；
- `cms-git-status.txt` 和 `cms-git-head.txt`：当时状态。

如果 CMS 工作区尚未初始化，status 文件会说明这一点，这不影响 PostgreSQL dump。

### 9.5 还必须另行保护的内容

普通备份故意不包含以下敏感或外部数据：

- 真实 `.env`；
- CMS Git 私钥和 `known_hosts`；
- 宿主机 HTTPS/DNS 配置；
- Actions 登录服务器的私钥；
- S3 图片二进制。

应把配置和密钥放进加密密码库，把备份复制到异机或加密远端，并为 S3 配置版本控制、复制或供应商备份策略。至少保留一份不与应用服务器共故障域的备份。

### 9.6 使用 systemd 定时备份

以下示例每天 03:20 运行。先创建 `/etc/systemd/system/vinci-cms-backup.service`：

```ini
[Unit]
Description=Back up Vinci CMS
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
User=vinci-deploy
WorkingDirectory=/opt/vinci-cms
ExecStart=/opt/vinci-cms/scripts/backup.sh
```

再创建 `/etc/systemd/system/vinci-cms-backup.timer`：

```ini
[Unit]
Description=Run Vinci CMS backup every day

[Timer]
OnCalendar=*-*-* 03:20:00
Persistent=true
RandomizedDelaySec=10m

[Install]
WantedBy=timers.target
```

启用前先人工运行一次 service：

```bash
sudo systemctl daemon-reload
sudo systemctl start vinci-cms-backup.service
sudo systemctl status vinci-cms-backup.service
sudo systemctl enable --now vinci-cms-backup.timer
systemctl list-timers vinci-cms-backup.timer
```

目的：

- service 定义执行什么；
- timer 定义何时执行；
- `Persistent=true` 让关机错过的任务在下次启动后补跑；
- 随机延迟避免多项定时任务同时抢 I/O。

本教程不提供自动删除旧备份的命令，避免 retention 配错后批量删除。先制定保留策略、异机复制和恢复演练，再单独审核清理方案。

## 10. 教程九：在隔离环境恢复演练

### 10.1 这个教程是做什么的

恢复演练验证“备份能恢复”，同时保证不触碰正常 `DATABASE_URL`、正常 Compose project 或现有 volume。

必须使用：

- 独立测试服务器或虚拟机；
- 独立仓库目录；
- 不同的 `COMPOSE_PROJECT_NAME`；
- 不同的 `APP_PORT`；
- 名称明确带 `test` 的空数据库；
- 测试 S3、测试 Git key 和测试凭据。

不要在生产项目目录里通过临时改 `.env` 做恢复演练。

### 10.2 建立隔离项目

在测试服务器执行：

```bash
git clone https://github.com/SDUTVINCI/sdutvinci_web.git \
  /opt/vinci-cms-restore-test
cd /opt/vinci-cms-restore-test
cp .env.example .env
chmod 600 .env
```

至少修改：

```dotenv
COMPOSE_PROJECT_NAME=vinci-cms-restore-test
APP_PORT=3100
POSTGRES_DB=vinci_cms_restore_test
POSTGRES_USER=vinci_restore_test
POSTGRES_PASSWORD=替换为测试专用随机密码
DATABASE_URL=postgresql://vinci_restore_test:替换为URL编码后的测试密码@postgres:5432/vinci_cms_restore_test
TEST_DATABASE_URL=postgresql://vinci_restore_test:替换为测试密码@127.0.0.1:55432/vinci_cms_restore_test
BACKUP_ROOT=/var/backups/vinci-cms-restore-test
```

同时把域名、CMS secret、Git key 和所有 S3 变量换成测试值。检查：

```bash
docker compose config --quiet
docker compose ps
```

预期：配置可解析，且没有复用正常项目的容器。

### 10.3 启动全新空 PostgreSQL

```bash
docker compose up -d --wait postgres
```

目的：只创建隔离项目自己的 `postgres_data` volume 和空数据库。

确认项目 label：

```bash
container_id="$(docker compose ps -q postgres)"
docker inspect --format \
  '{{ index .Config.Labels "com.docker.compose.project" }} / {{ index .Config.Labels "com.docker.compose.service" }}' \
  "$container_id"
```

预期：

```text
vinci-cms-restore-test / postgres
```

如果不一致，立即停止，不要运行恢复脚本。

### 10.4 恢复测试备份

只选择由测试环境生成、且已复制到项目目录之外的备份。先独立检查路径：

```bash
backup_dir='/绝对路径/替换为测试备份目录'
realpath "$backup_dir"
test -d "$backup_dir"
```

然后使用与当前隔离项目和目标数据库精确匹配的确认令牌：

```bash
RESTORE_CONFIRM='vinci-cms-restore-test:vinci_cms_restore_test' \
  ./scripts/restore.sh "$backup_dir"
```

恢复脚本会依次：

1. 拒绝相对路径、项目内路径和符号链接目录；
2. 校验必需文件和所有 SHA-256；
3. 检查备份格式；
4. 校验当前 PostgreSQL 容器的 Compose project 和 service；
5. 校验当前数据库名与用户；
6. 要求目标数据库完全没有用户表；
7. `pg_restore --list` 成功后才写入；
8. 使用 `--exit-on-error` 恢复。

脚本不会 `DROP DATABASE`、不会 `--clean`，也不会覆盖非空数据库。

### 10.5 执行向前 migration 并启动

读取备份 manifest 中的仓库 commit，并确保使用该 commit 或更新的、已发布的镜像。然后：

```bash
target_commit='替换为对应的40位镜像SHA'
APP_IMAGE_TAG="$target_commit" \
  docker compose --profile tools run --rm migrate
APP_IMAGE_TAG="$target_commit" \
  docker compose up -d --wait app-blue app-green gateway
```

目的：

- 先把恢复的数据升级到当前代码要求的 schema；
- 再启动隔离应用和 gateway。

这两条是恢复演练的直接启动方式。正式自动部署仍应使用 `scripts/deploy.sh` 建立 `.deploy/current`。

### 10.6 验证恢复结果

```bash
curl --fail http://127.0.0.1:3100/api/health
docker compose ps
docker compose logs --tail=100 postgres app-blue app-green gateway
```

再人工确认：

- 测试用户、草稿、审核、审计、发布记录数量符合备份预期；
- 正式 Markdown 可从测试 GitHub clone；
- 随机测试图片 URL 可读取；
- CMS 登录和只读浏览正常；
- 没有连接正常数据库或生产 S3。

最后再运行一次同一恢复命令。预期脚本因目标数据库已有用户表而拒绝。这是防覆盖保护的验收，不要为让它通过而清空数据库。

### 10.7 恢复中断时怎么办

如果 `pg_restore` 中途失败，目标测试库可能已经部分写入，因此脚本会把它视为非空并拒绝重试。

正确做法是在已明确确认的**隔离测试项目**中重新创建一个新的空目标数据库或新的 Compose project，再重新恢复。不要删除正常项目 volume，也不要在不确定容器归属时执行任何清理命令。

### 10.8 审查 CMS Git 异常资料

这些文件不会自动覆盖正式 GitHub：

```bash
git clone "$backup_dir/cms-git-refs.bundle" \
  /安全的临时审查目录
git -C /安全的临时审查目录 log --all --oneline
git -C /安全的临时审查目录 apply --check \
  "$backup_dir/cms-git-working-tree.patch"
tar -tzf "$backup_dir/cms-git-untracked.tar.gz"
```

目的：先确认是否真的存在未 push 的内容。只有人工审核后，才能按普通 commit 和非强制 push 流程恢复到 GitHub。不要直接覆盖 `cms_git_worktree` volume。

## 11. 教程十：迁移到全新 Linux 服务器

### 11.1 这个教程是做什么的

用于换服务器或旧服务器故障恢复。源码和 Markdown来自 GitHub，数据库来自 `pg_dump`，图片继续来自 S3，敏感配置来自加密密码库。

如果要求迁移期间所有最新草稿和审核记录一致，最终切换需要短暂阻止旧站写入。蓝绿发布解决单机版本切换，不会自动解决两台服务器同时写同一数据库的问题。

### 11.2 先完成一次非生产演练

先完整执行教程九。只有隔离恢复成功，才进入真实迁移。记录：

- 恢复耗时；
- migration 耗时；
- DNS TTL；
- 需要验证的业务清单；
- 出错时恢复旧站入口的负责人和命令。

### 11.3 准备新服务器

在新服务器完成教程二，但先使用测试域名或仅本机访问：

1. 安装 Docker、Compose plugin、Git 和 curl；
2. 克隆 GitHub 仓库；
3. 从加密密码库恢复 `.env`、CMS Git key 和 `known_hosts`；
4. 配置读取 GHCR；
5. 准备宿主机 HTTPS 配置；
6. 不切换正式 DNS；
7. 不让新旧服务器同时接受 CMS 写入。

S3 公共域名不变时，原 Markdown 图片链接无需修改。更换图片域名是独立内容迁移，不能在数据库恢复脚本中静默改写。

### 11.4 创建迁移前备份

先在旧服务器做一次普通预备备份并检查，以估算时间：

```bash
cd /opt/vinci-cms
./scripts/backup.sh
```

正式切换时，为保证最终一致性：

1. 宣布维护窗口；
2. 停止旧服务器的公网 gateway，阻止新的登录、草稿和审核写入；
3. 保持 app 和 postgres 运行，便于备份数据库和 CMS Git 状态；
4. 创建最终备份。

旧服务器执行：

```bash
cd /opt/vinci-cms
docker compose stop gateway
./scripts/backup.sh
```

从另一台机器确认旧入口已停止接受请求。把脚本打印的最终备份目录通过加密、校验的通道复制到新服务器项目目录之外。

如果此时决定取消迁移，可在旧服务器恢复入口：

```bash
docker compose start gateway
curl --fail http://127.0.0.1:3000/api/health
```

### 11.5 在新服务器恢复

按教程九相同原则，先确认新服务器的 Compose project、数据库名和容器 label，再执行：

```bash
docker compose up -d --wait postgres
RESTORE_CONFIRM='vinci-cms:vinci_cms' \
  ./scripts/restore.sh /绝对路径/最终备份目录
```

然后使用目标 commit 的 operations 镜像执行 migration，并使用 `scripts/deploy.sh` 完成正式蓝绿初始化：

```bash
target_commit='替换为已发布的40位commit SHA'
DEPLOY_COMMIT="$target_commit" \
DEPLOY_MODE=application \
APP_IMAGE=ghcr.io/sdutvinci/sdutvinci_web \
APP_OPS_IMAGE=ghcr.io/sdutvinci/sdutvinci_web-ops \
APP_IMAGE_TAG="$target_commit" \
./scripts/deploy.sh
```

`deploy.sh` 会再次执行幂等、向前 migration，然后建立活动槽位和 `.deploy/current`。

### 11.6 切换前验证

先通过测试域名、临时 DNS 或受控的 hosts 解析访问新服务器。逐项检查：

- `/api/health`；
- 前台首页、新闻、Wiki 等关键页面；
- 管理员登录；
- 草稿、审核、审计和历史；
- CMS Git 发布使用的是目标仓库；
- S3 图片来自预期 Bucket 和公开域名；
- HTTPS 证书和回环反代；
- `.deploy/current` 与目标 SHA。

验证失败时不要切 DNS。修复新服务器，或重启旧 gateway 恢复原站。

### 11.7 正式切换

确认新站正确后：

1. 把正式 DNS 或负载均衡入口切到新服务器；
2. 更新 GitHub `production` environment 中的 `DEPLOY_HOST`、host key 等 Secrets；
3. 通过一个新的受审核 `main` push 验证 Actions 能部署新服务器；
4. 观察 DNS TTL、访问日志、健康和业务功能；
5. 旧服务器保持停止写入的只读/关闭入口状态一段观察期。

不要在确认 Actions 已指向新服务器前下线旧服务器，也不要让两个服务器同时接收 CMS 写入。最终观察期结束后再按单独审核的下线流程处理旧资源。

### 11.8 旧服务器完全损坏时

无法创建最终备份时：

1. 从 GitHub clone 代码和 Markdown；
2. 取最近一份异机 PostgreSQL 备份；
3. 从加密密码库恢复配置和密钥；
4. 继续使用原 S3 或按独立方案恢复图片；
5. 按教程九恢复到空数据库；
6. 验证后切换 DNS 和 Actions Secrets。

可恢复点取决于最近一次成功备份。CMS Git 异常 bundle/patch 只能补救备份时已捕获但尚未 push 的内容。

## 12. 教程十一：失败与回滚

### 12.1 候选镜像启动失败

部署脚本在切换前会检查候选槽位。候选失败时：

- 旧活动槽位继续服务；
- gateway 不应切换；
- 失败候选容器保留供排查；
- 仓库尝试回到 previous commit；
- 脚本返回失败，Actions 标红。

检查：

```bash
cd /opt/vinci-cms
sed -n '1,20p' .deploy/current
docker compose ps
docker compose logs --tail=200 app-blue app-green gateway
curl --fail http://127.0.0.1:3000/api/health
```

不要为了“清干净”立即删除失败容器；先保留日志和镜像信息。

### 12.2 切换后发现功能回归

部署脚本禁止把线上 commit 倒序部署，所以正确回滚方式是在 Git 中创建一个新的向前 commit：

```bash
git switch main
git pull --ff-only origin main
git revert 出问题的commitSHA
git push origin main
```

目的：保留公开、可审计的历史，并让 Actions 为回滚内容生成一个新的不可变 SHA 镜像。

不要 force-push `main`，不要把旧 SHA 硬塞给部署脚本，也不要手工伪造 `.deploy/current`。

### 12.3 migration 已执行但应用失败

当前系统不自动 down migration。旧应用继续服务的前提是新 migration 向后兼容。

处理顺序：

1. 保持或恢复旧活动槽位；
2. 检查 migration 实际完成到哪一步；
3. 创建新的向前修复 migration 或兼容代码；
4. 在隔离测试数据库验证；
5. 通过新 commit 正常发布。

若 migration 本身破坏旧应用兼容性，应立即进入维护窗口，由数据库负责人根据已验证备份和修复方案处理，不要边试边删表或恢复到非空库。

### 12.4 操作锁报错

如果提示 `.deploy/operation.lock` 已存在，先检查是否真的有部署、备份或恢复进程：

```bash
ps aux | grep -E '[d]eploy\.sh|[b]ackup\.sh|[r]estore\.sh'
ls -ld /opt/vinci-cms/.deploy/operation.lock
```

只有确认前一个进程已经结束、没有 Docker 或数据库操作仍在进行后，才能由运维人员处理遗留锁目录。不要在另一个操作仍运行时绕过锁。

## 13. 阶段 8 人工验收清单

所有验收都应在测试仓库或 fork、测试 GHCR、测试服务器、测试 PostgreSQL 和测试 S3 中完成。

### 13.1 Docker 与首次部署

- [ ] `.env` 不含占位符，权限为 600，未进入 Git。
- [ ] CMS Git key 与 Actions SSH key 是两把不同的密钥。
- [ ] `docker compose config --quiet` 通过。
- [ ] 首次 `application` 部署成功并生成 `.deploy/current`。
- [ ] PostgreSQL、活动槽位和 gateway 健康。
- [ ] 只有 gateway 绑定 `127.0.0.1:${APP_PORT}`，PostgreSQL 未暴露宿主机端口。
- [ ] 管理员可登录，前台和 CMS 原有阶段 1～7 功能正常。

### 13.2 自动部署与无中断切换

- [ ] 仅本地 commit 不触发；push `main` 后 Actions 触发。
- [ ] 纯 `content/**` commit 分类为 `content`。
- [ ] 内容发布跳过 operations 和 migration，但构建 runtime。
- [ ] 连续健康请求没有失败，新 Markdown 页面可见。
- [ ] Vue 或 TypeScript commit 分类为 `application`。
- [ ] 完整发布构建两个镜像并执行 migration。
- [ ] 不存在的测试镜像 tag 使候选失败，旧槽位仍健康。
- [ ] `content` 模式搭配代码变化时，服务器在 migration 前拒绝。
- [ ] 倒序或分叉 commit 被服务器拒绝。

### 13.3 备份、恢复与迁移

- [ ] 备份目录位于项目外，checksum 和 `pg_restore --list` 通过。
- [ ] manifest、配置 checklist 和 CMS Git 异常资料符合预期。
- [ ] `.env`、私钥和 S3 图片没有混入普通备份。
- [ ] 隔离 Compose project 的空测试数据库恢复成功。
- [ ] 对非空目标再次恢复被拒绝。
- [ ] 新测试服务器无需修改源码即可启动。
- [ ] GitHub Markdown、测试 S3 图片和 PostgreSQL 业务数据均正常。
- [ ] 更新测试 Actions Secrets 后，新 `main` push 能部署到新服务器。
- [ ] 故障时能通过新 Git revert commit 前向回滚。

人工验收通过后，才能勾选需求文档中的阶段 8 总体进度。阶段 9 不属于本教程，也不得因完成上述验收而自动启动。
