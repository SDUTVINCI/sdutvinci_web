# Vinci V2.0 `.env` 逐项配置手册

本文覆盖当前 [`.env.example`](../../.env.example) 的全部生产配置项。先按
[`OPERATIONS.md`](OPERATIONS.md) 第 1 节完成 V2 应用仓库的全新 clone 和镜像 SHA 核对，再在
clone 根目录按本文填写 `.env`。不要把本文示例中的 `replace-*`、尖括号或假域名原样用于生产。

本文的职责到“配置填写和只读预检通过”为止，**不执行正式安装，也不把 `status`/`doctor` 当作
安装前检查**。第 11 节通过后，统一回到 [`DEPLOYMENT.md`](../DEPLOYMENT.md#2-全新空库正式部署)
第 2 节执行唯一的正式部署顺序；命令原理、失败处理和高级排障再查 `OPERATIONS.md`。

## 1. 填写规则与安全验证

- `.env` 每行使用 `KEY=value`，不要写 `export KEY=...`。变量名不能改，布尔值只写小写
  `true` 或 `false`。
- 注释单独写在上一行。不要在密码或 URL 行末追加 `# 注释`，也不要依赖 shell 的 `$()`、反引号
  或变量展开；Compose 不会把它们当作安全的密码生成器。
- 先在密码管理器中生成随机值，再通过受控编辑器写入。不要在聊天、工单、Git、shell 参数或
  截图中传递 `POSTGRES_PASSWORD`、`DATABASE_URL`、`CMS_AUTH_SECRET`、S3 key 或 GitHub Token。
- `.env` 必须是当前安装用户所有的普通文件，权限 `0600`，不能是 symlink。
- 路径必须使用绝对路径；备份、实例包和日志目录必须位于代码仓库之外，不能是 `/` 或用户
  Home 根。

```bash
chmod 600 .env             # 开始填写前就限制为仅当前 owner 可读写
stat -c '%a %U:%G %n' .env # 预期：600 <当前用户>:<当前组> .env
```

此处只是开始逐项填写，**不要提前运行** `docker compose config` 或 `./vinci install --dry-run`。
必须依次完成第 2～10 节、移除所有模板占位值，再到第 11 节执行一次整体验证。全局 Dry Run 即使
通过，也只证明配置形状和宿主机预检通过，不证明 S3、Git、数据库密码或镜像凭据真实可用。

从 `.env.example` 复制后可以先按三类处理：

- 必须替换：`APP_IMAGE_TAG`、`NUXT_PUBLIC_SITE_URL`、数据库密码与 URL、`CMS_AUTH_SECRET`、全部
  S3/COS 连接项、内容仓库 SSH 文件路径。
- 生产固定或建议原样保留：`APP_BIND_ADDRESS=127.0.0.1`、`APP_PORT=3000`、
  `NODE_ENV=production`、`CONTENT_PUBLISH_MODE=database`、两个内容仓库 ID、
  `CONTENT_EXPORT_BRANCH=main`、`CONTENT_RECOVERY_MODE=disabled`、
  `CONTENT_PR_IMPORT_TEST_MODE=false`。
- 首次保持安全关闭：`AUTO_DEPLOY_ENABLED=false`、`CONTENT_EXPORT_MODE=disabled`、
  `CONTENT_PR_IMPORT_MODE=disabled`。这些功能各自完成前置验收后再单独开启。

其余限流、批量、重试和保留参数可以先保留模板默认值，观察实际容量和日志后再调整；不要在
首次部署时一次性“优化”所有数值。

## 2. Docker、镜像、监听地址与站点 URL

| 参数 | 生产环境怎么填 | 约束、默认值和影响 |
| --- | --- | --- |
| `COMPOSE_PROJECT_NAME` | 本机唯一且长期不变的名称，单实例建议保留 `vinci-cms` | 决定容器、network、volume 和确认令牌名称。部署后修改会创建另一套资源，看起来像“数据消失”。建议只用小写字母、数字、`-`、`_`。 |
| `APP_IMAGE` | runtime 镜像仓库，例如 `ghcr.io/sdutvinci/sdutvinci_web` | 只填仓库，不带 `:tag`；必须与 Actions 实际发布目标一致。 |
| `APP_OPS_IMAGE` | operations 镜像仓库，例如 `ghcr.io/sdutvinci/sdutvinci_web-ops` | 用于 Migration、管理员创建、doctor、导出和恢复；必须与 runtime 来自同一 Commit。 |
| `APP_IMAGE_TAG` | 首次安装所用、CI 已发布的完整 40 位小写 Commit SHA | 不填 `latest`。`./vinci install/update` 部署时会显式传入目标 SHA，活动版本以 `.deploy/current` 为准；此字段仍是 Compose 工具的默认镜像 tag。 |
| `APP_BIND_ADDRESS` | 保持 `127.0.0.1` | gateway 只监听服务器回环，避免绕过 1Panel/TLS 直接暴露。不要为了外部访问改成 `0.0.0.0`。 |
| `APP_PORT` | 当前服务器保持 `3000` | 这是宿主机 gateway 端口；1Panel 的 `18080 → 127.0.0.1:3000` 反代无需修改。端口必须空闲。 |
| `NODE_ENV` | 固定 `production` | 不要在生产改成 `test`；多个测试保护开关依赖它拒绝生产误用。Compose 运行时也会固定 production。 |
| `NUXT_PUBLIC_SITE_URL` | 浏览器最终访问站点的完整外部 origin，例如 `https://www.example.com` | 包含协议和非默认端口，不带后台路径。它参与绝对链接和 CMS 同源/CSRF 判断；必须与反向代理对外地址一致。生产应使用 HTTPS。 |

对于当前 1Panel 场景，应用侧保持：

```dotenv
APP_BIND_ADDRESS=127.0.0.1
APP_PORT=3000
```

1Panel 可以继续监听 `18080` 并转发到 `127.0.0.1:3000`。`NUXT_PUBLIC_SITE_URL` 填用户浏览器看到的
地址，而不是一律填 `http://127.0.0.1:3000`。

| 浏览器实际入口 | `NUXT_PUBLIC_SITE_URL` | `CMS_SECURE_COOKIES` |
| --- | --- | --- |
| 1Panel 提供 HTTPS 域名 | 例如 `https://vinci.example.com` | `true`（生产推荐） |
| 仅在可信内网临时使用 `http://10.0.0.4:18080` | 精确填 `http://10.0.0.4:18080` | 临时 `false`，否则浏览器不会通过 HTTP 发送 Secure Cookie |

内网 HTTP 只适合部署调试，不是公网生产方案。给 1Panel 外部入口配置 HTTPS 不需要改变后端
`127.0.0.1:3000`，也不需要删除现有 18080 反向代理。

## 3. PostgreSQL

| 参数 | 生产环境怎么填 | 约束、默认值和影响 |
| --- | --- | --- |
| `POSTGRES_DB` | 建议保留 `vinci_cms` | 数据库名。备份、恢复和实例导入会精确校验它；只用字母、数字、下划线、短横线，且以字母或下划线开头。 |
| `POSTGRES_USER` | 建议保留 `vinci_cms` 或使用本实例专用账号 | PostgreSQL owner/连接账号，命名限制同上。不要复用其他应用账号。 |
| `POSTGRES_PASSWORD` | 密码管理器生成的长随机原始密码，推荐 `openssl rand -hex 32` 的 64 位十六进制结果 | 它与 `DATABASE_URL` 密码段代表同一个密码；URL 中出现的是原始值的 percent-encoded 形式。不要复用 CMS/S3/Git 密钥。已初始化 volume 后只改这里不会自动修改数据库内密码。 |
| `DATABASE_URL` | 默认 Compose 形态为 `postgresql://<用户>:<同一密码的URL编码结果>@postgres:5432/<数据库>` | host 固定用 Compose service 名 `postgres`，不是 `127.0.0.1`。用户、密码、库名必须与上面三项一致。推荐十六进制密码无需额外编码。 |
| `TEST_DATABASE_URL` | 生产服务器不运行集成测试时建议留空；需要测试时填独立测试库 | 绝不能指向生产库。数据库名必须包含独立的 `test` 段，例如 `vinci_cms_test`，并使用回环测试端口、独立账号和测试凭据。生产服务不读取它。 |
| `DATABASE_POOL_MAX` | 4 核/8 GiB 单实例先保留 `10` | 每个应用进程的最大连接池。必须为正整数；盲目增大会耗尽 PostgreSQL 连接。蓝绿切换期间两个 app 可能短暂并存。 |
| `DATABASE_SSL` | 本仓库内置 Compose PostgreSQL 填 `false` | 只有改用受信任 CA 的外部 PostgreSQL 时才填 `true`；当前实现启用严格证书验证，不能关闭证书校验。 |

### 3.1 推荐的随机密码生成方式

在服务器本机执行：

```bash
openssl rand -hex 32 # 生成 32 随机字节，输出 64 个十六进制字符；只用于 PostgreSQL
openssl rand -hex 32 # 必须重新运行一次，生成另一个独立值用于 CMS_AUTH_SECRET
```

第一条输出只包含 `0-9a-f`，具有 256 bit 随机量且可直接用于 URL。不要把输出发到聊天、工单或
Git；复制到密码管理器和 `.env` 后清理终端可见内容。假设生成结果用占位符 `<同一64位十六进制值>`
表示，数据库四项应保持这种关系：

```dotenv
POSTGRES_DB=vinci_cms
POSTGRES_USER=vinci_cms
POSTGRES_PASSWORD=<同一64位十六进制值>
DATABASE_URL=postgresql://vinci_cms:<同一64位十六进制值>@postgres:5432/vinci_cms
```

这里两处必须是同一串字符。由于十六进制字符不需要 percent-encoding，最适合人工首次部署。
第二次 `openssl rand -hex 32` 的输出填 `CMS_AUTH_SECRET`，绝不能复用数据库密码。

### 3.2 密码 URL 编码表

如果没有采用十六进制方案，而是使用密码管理器生成的含特殊字符密码，则
`POSTGRES_PASSWORD` 填原始值，`DATABASE_URL` 只对密码段编码，不能把整个 URL 编码。例如原始
密码 `a/b@c` 在 URL 的密码段写成 `a%2Fb%40c`。

| 原字符 | URL 编码 | 原字符 | URL 编码 |
| --- | --- | --- | --- |
| 空格 | `%20` | `%` | `%25` |
| `!` | `%21` | `#` | `%23` |
| `$` | `%24` | `&` | `%26` |
| `'` | `%27` | `(` | `%28` |
| `)` | `%29` | `*` | `%2A` |
| `+` | `%2B` | `,` | `%2C` |
| `/` | `%2F` | `:` | `%3A` |
| `;` | `%3B` | `=` | `%3D` |
| `?` | `%3F` | `@` | `%40` |
| `[` | `%5B` | 反斜杠（backslash） | `%5C` |
| `]` | `%5D` | `"` | `%22` |
| `<` | `%3C` | `>` | `%3E` |
| `^` | `%5E` | 反引号（backtick） | `%60` |
| `{` | `%7B` | 竖线（pipe） | `%7C` |
| `}` | `%7D` |  |  |

编码中的十六进制字母大小写均可，但建议统一大写。特别注意：Base64 随机值常见的 `+`、`/`、`=`
分别要写成 `%2B`、`%2F`、`%3D`；`%` 自身必须写成 `%25`。不要用在线编码网站处理真实密码。

确需编码时可在服务器本机隐藏输入并使用已经安装的 Node：

```bash
read -r -s -p 'Raw database password: ' raw_db_password; printf '\n' # 输入原始密码，不回显
RAW_DB_PASSWORD="$raw_db_password" node -e \
  'process.stdout.write(encodeURIComponent(process.env.RAW_DB_PASSWORD).replace(/[!\x27()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`))'
  # 上一行按严格 RFC 3986 输出编码结果，只供填写 DATABASE_URL 的密码段
printf '\n'
unset raw_db_password
```

编码结果仍然是数据库秘密，不得保存到日志或发送给他人。`.env` 对 `$`、引号等字符还有 Compose
解析规则，因此生产首次部署仍强烈推荐十六进制方案，避免同时处理 URL 编码和 `.env` 转义。

### 3.3 `TEST_DATABASE_URL` 怎么填

生产运行、`./vinci install`、备份和定时任务都不读取 `TEST_DATABASE_URL`。如果这台生产服务器
不承担集成测试，最安全且最清晰的写法是：

```dotenv
TEST_DATABASE_URL=
```

如果以后在隔离环境运行测试，可以使用简单但独立的测试凭据，例如：

```dotenv
TEST_DATABASE_URL=postgresql://vinci_test:vinci-test-only-password@127.0.0.1:55432/vinci_cms_test
```

这个示例只有在 `127.0.0.1:55432` 上确实运行匹配的隔离测试 PostgreSQL 时才可用；它不会自动
创建数据库。测试数据库名必须匹配 `(^|[-_])test($|[-_])`，因此 `vinci_cms_test` 合法；测试
辅助代码还会拒绝与 `DATABASE_URL` 相同的 host、port 和数据库组合。简单测试密码不代表可以
暴露端口：测试服务仍须只绑定回环、使用名称含 test 的容器/volume/数据库和独立测试账号。

数据库 volume 初始化后若要换密码，必须先在 PostgreSQL 内安全轮换，再同步更新
`POSTGRES_PASSWORD` 和 `DATABASE_URL`；不能只编辑 `.env`。

## 4. CMS 会话、登录限流和上传限流

| 参数 | 生产环境怎么填 | 允许范围与作用 |
| --- | --- | --- |
| `CMS_AUTH_SECRET` | 密码管理器生成的独立随机秘密，至少 32 个字符，建议 64 个十六进制字符或等强度值 | 用于会话/安全 HMAC。轮换会使现有登录会话和相关令牌失效；不要与任何其他密码复用。 |
| `CMS_SESSION_COOKIE` | 单站点保留 `vinci_cms_session` | Cookie 名不能为空。同一域名部署多个隔离实例时必须使用不同名称，避免相互覆盖。 |
| `CMS_SESSION_TTL_HOURS` | 默认 `168`（7 天） | 正整数，最大 `2160`（90 天）。缩短会增加重新登录频率，延长会增加失窃会话暴露窗口。 |
| `CMS_SECURE_COOKIES` | 有 HTTPS 的生产环境固定 `true` | 为 `true` 时浏览器只通过 HTTPS 发送登录 Cookie。纯 HTTP 的隔离调试才可临时用 `false`；公网生产不能因此关闭 HTTPS 保护。 |
| `CMS_LOGIN_FAILURE_LIMIT` | 默认 `5` | 同一账号在窗口内允许的失败次数，范围 `2–20`；达到后锁定账号桶。 |
| `CMS_LOGIN_FAILURE_WINDOW_MINUTES` | 默认 `15` | 统计账号登录失败的窗口，范围 `1–1440` 分钟。 |
| `CMS_LOGIN_LOCKOUT_MINUTES` | 默认 `15` | 账号达到失败阈值后的锁定时间，范围 `1–1440` 分钟。不要通过调大失败上限来处理误锁。 |
| `CMS_LOGIN_IP_ATTEMPT_LIMIT` | 默认 `30` | 单一来源 IP 在窗口内的登录尝试上限，范围 `5–1000`。反向代理必须正确传递可信客户端 IP。 |
| `CMS_LOGIN_IP_WINDOW_MINUTES` | 默认 `5` | IP 登录尝试统计窗口，范围 `1–1440` 分钟。 |
| `CMS_MEDIA_UPLOAD_LIMIT` | 默认 `20` | 单个已登录用户在窗口内的上传次数，范围 `1–1000`。 |
| `CMS_MEDIA_UPLOAD_WINDOW_MINUTES` | 默认 `1` | 媒体上传限流窗口，范围 `1–1440` 分钟。 |

`NUXT_PUBLIC_SITE_URL`、1Panel 转发的 Host/Proto 与 `CMS_SECURE_COOKIES` 必须一致。若 HTTPS 站点
出现登录后立即掉线，先检查代理是否正确传递协议以及浏览器访问地址，不要直接关闭 Secure
Cookie、CSRF 或同源校验。

## 5. 内容权威、独立内容仓库与异步导出

| 参数 | 生产环境怎么填 | 允许值、启用条件和作用 |
| --- | --- | --- |
| `CONTENT_PUBLISH_MODE` | 固定 `database` | V2 正式内容权威是 PostgreSQL。`legacy_git`、`revision_shadow` 只允许隔离测试；不要重新引入代码仓库 `content/`。 |
| `CONTENT_REPOSITORY_ID` | 固定 `SDUTVINCI/sdutvinci_content` | 代码会拒绝其他正式仓库。格式是 `owner/repository`，不含协议或 `.git`。 |
| `CONTENT_EXPORT_MODE` | 首次先用 `disabled`；接管 Dry Run 用 `dry_run`；明确确认后才用 `enabled` | `disabled` 禁止增量 Worker；`dry_run` 只允许接管报告；`enabled` 允许正式 Commit/Push。不能跳过接管验收直接启用。 |
| `CONTENT_EXPORT_REMOTE_URL` | 正式使用 `git@github.com:SDUTVINCI/sdutvinci_content.git` | 正式环境只接受唯一官方仓库的 HTTPS/SSH 形式；enabled 时必须是仓库级 SSH remote，且 URL 不能内嵌用户名密码或 Token。 |
| `CONTENT_EXPORT_REMOTE` | 保留 `origin` | 本地 remote 名，仅允许字母、数字、点、下划线和短横线。不是 URL。 |
| `CONTENT_EXPORT_BRANCH` | 固定 `main` | 正式代码只接受 main；不填功能分支。导出只做普通 fast-forward Push，绝不 Force Push。 |
| `CONTENT_EXPORT_WORKSPACE` | 保留 `/var/lib/vinci-cms/content-export` | 必须与应用代码、旧 content 和其他 Git worktree 隔离。标准 Compose 使用专用 named volume 映射到该容器路径。 |
| `CONTENT_EXPORT_AUTHOR_NAME` | 机器人可识别名称，例如 `Vinci Content Exporter` | 写入自动内容 Commit 的 author/committer，不是 GitHub 登录凭据。不能为空。 |
| `CONTENT_EXPORT_AUTHOR_EMAIL` | 机器人邮箱，例如 `content-export@localhost` 或组织 noreply 地址 | 必须是合法邮箱格式；不要填维护者私人敏感邮箱。 |
| `CONTENT_EXPORT_SSH_KEY_FILE` | 宿主机上独立 deploy key 私钥的绝对路径 | 必须是普通非 symlink 文件、权限 `0600`，仅授权目标内容仓库，正式对账/导出需要写权限。不要使用个人通用 SSH 私钥。 |
| `CONTENT_EXPORT_KNOWN_HOSTS_FILE` | 独立 known_hosts 文件的绝对路径 | 必须是普通非 symlink 文件；先通过可信渠道核对 GitHub host key，不能只信任 `ssh-keyscan` 输出。 |
| `CONTENT_EXPORT_BATCH_SIZE` | 默认 `50` | Worker 每轮领取任务数，范围 `1–200`。大批量会增加单轮事务和 Git Commit 体积。 |
| `CONTENT_EXPORT_POLL_SECONDS` | 默认 `60` | Worker 空闲轮询间隔，范围 `1–3600` 秒。越小对 DB 查询越频繁。 |
| `CONTENT_EXPORT_LEASE_SECONDS` | 默认 `300` | Worker job 租约，范围 `30–3600` 秒。应覆盖正常单批导出时间；过短会造成过期接管。 |
| `CONTENT_EXPORT_MAX_ATTEMPTS` | 默认 `5` | 单 job 最大尝试次数，范围 `1–20`；到达上限转人工处理。 |
| `CONTENT_EXPORT_RETRY_BASE_SECONDS` | 默认 `60` | 指数退避初始秒数，范围 `1–3600`。 |
| `CONTENT_EXPORT_RETRY_MAX_SECONDS` | 默认 `3600` | 指数退避上限，范围 `1–86400` 秒，且不得小于 base。 |
| `CONTENT_RECONCILIATION_ROOT` | 保留 `/var/lib/vinci-cms/content-reconciliation` | 对账 snapshot/report/tmp 根。必须与导出 workspace 隔离；标准 Compose 使用专用 named volume，宿主机高级脚本使用此安全绝对路径。 |
| `CONTENT_RECOVERY_MODE` | 正式 `.env` 固定 `disabled` | 普通 app、Worker 和对账不能启用恢复；`./vinci install --initialize=snapshot` 会在隔离 recovery profile 内受控启用。 |

即使 `CONTENT_EXPORT_MODE=disabled`，03:00 全量对账仍需要读取并在有差异时修正独立内容仓库，
因此生产安装必须为 `CONTENT_EXPORT_SSH_KEY_FILE` 和 `CONTENT_EXPORT_KNOWN_HOSTS_FILE` 配置真实、
最小权限文件。`disabled` 只表示增量 Outbox Worker 尚未接管，不表示对账不需要 Git 凭据。

### 5.1 创建内容仓库专用 SSH Deploy Key

#### 前置条件

- 宿主机已安装 OpenSSH client，`ssh-keygen`、`ssh-keyscan` 和 `ssh` 命令可用。
- 下列命令以将来运行 `./vinci` 和 systemd 的同一普通用户执行，不使用 `sudo ssh-keygen`。
- 维护者对 `SDUTVINCI/sdutvinci_content` 有仓库管理员权限；密钥只添加到这个**内容仓库**，不添加
  到 `sdutvinci_web` 代码仓库，也不复用个人的 `~/.ssh/id_*`。
- 自动导出和 03:00 对账都可能普通 Push，因此 Deploy Key 必须在 GitHub 勾选写权限。
- 无口令私钥是为了让无人值守的 systemd/Compose 任务能够启动；风险通过“一仓库一密钥”、目录
  `0700`、私钥 `0600` 和及时吊销控制。不要把该私钥复制到第二台服务器。

先在宿主机创建仅当前用户可访问的凭据目录和一对独立 Ed25519 密钥：

```bash
credential_root="$HOME/.config/vinci-cms/content-export" # 宿主机固定目录；不要放在代码仓库或 /tmp
install -d -m 0700 "$credential_root"                    # 创建目录；只有当前用户可进入和读取
test ! -e "$credential_root/deploy-key"                  # 预期无输出且退出码为 0，防止覆盖既有私钥
test ! -e "$credential_root/deploy-key.pub"              # 预期无输出且退出码为 0，防止覆盖既有公钥
umask 077                                                  # 后续新文件默认只允许当前用户访问
ssh-keygen -t ed25519 -N '' \
  -C 'vinci-content-export@debian' \
  -f "$credential_root/deploy-key"                        # 生成无人值守专用密钥；不要改成个人私钥路径
chmod 600 "$credential_root/deploy-key"                  # 私钥只允许 owner 读写
chmod 644 "$credential_root/deploy-key.pub"              # 公钥不是秘密，可供复制和审计
```

`ssh-keygen` 预期报告私钥、公钥路径和指纹，不应提示覆盖文件。任何 `test` 失败都表示路径已经存在：
先确认它的来源和 GitHub 授权，绝不能直接覆盖。输出公钥并在 GitHub 页面登记：

```bash
sed -n '1p' "$credential_root/deploy-key.pub" # 只显示单行公钥；绝不能显示或发送 deploy-key 私钥
```

1. 打开 GitHub 的 `SDUTVINCI/sdutvinci_content` → **Settings** → **Deploy keys** →
   **Add deploy key**。
2. Title 填可追踪且唯一的服务器名，例如 `vinci-content-export-debian-20260802`。
3. Key 粘贴上一步的整行 `.pub` 公钥。
4. **必须勾选 Allow write access**，然后添加。Deploy Key 默认只读；不勾选时能 clone，但自动导出
   和对账 Push 会失败。

[GitHub Deploy Key](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys)
一把只能附加到一个仓库；如果提示 key already in use，不要复用，应为这台服务器重新生成一对。如果
组织策略隐藏或禁止 Deploy keys，停止配置并由组织管理员放行目标仓库，不能改用个人通用密钥绕过。

### 5.2 创建并核验独立 known_hosts

`ssh-keyscan` 只负责采集候选 host key，本身不会证明对端真是 GitHub。必须将候选 Ed25519 指纹与
[GitHub 官方 SSH key fingerprints](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints)
通过当前可信 HTTPS 页面逐字核对：

```bash
known_hosts_candidate="$credential_root/known-hosts.candidate" # 候选文件，尚未获得信任
test ! -e "$known_hosts_candidate"                             # 预期无输出且退出码为 0，防止覆盖审计线索
test ! -e "$credential_root/known-hosts"                       # 首次配置应不存在正式文件
umask 077                                                       # 确保重定向创建的文件不是全局可读
ssh-keyscan -t ed25519 github.com > "$known_hosts_candidate"   # 仅采集候选，不因命令成功就直接信任
ssh-keygen -lf "$known_hosts_candidate"                        # 计算候选 key 的 SHA-256 指纹
```

截至本文更新时，预期指纹为
`SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU`（ED25519）。必须以执行当天 GitHub
官方页面显示的当前值为准；不一致时停止，不要移动候选文件、不要关闭
`StrictHostKeyChecking`，应先检查 DNS、代理、网络劫持或 GitHub 官方轮换公告。核对完全一致后：

```bash
mv -- "$known_hosts_candidate" "$credential_root/known-hosts" # 只有人工核验后才提升为受信文件
chmod 600 "$credential_root/known-hosts"                       # 仅运行服务的当前用户可修改
test ! -L "$credential_root/deploy-key"                        # 预期成功：私钥不得是 symlink
test ! -L "$credential_root/known-hosts"                       # 预期成功：known_hosts 不得是 symlink
stat -c '%a %U:%G %n' \
  "$credential_root" \
  "$credential_root/deploy-key" \
  "$credential_root/known-hosts"                              # 预期权限依次为 700、600、600，owner 为当前用户
```

### 5.3 验证内容仓库访问并填写 `.env`

用刚生成的两个文件显式连接目标内容仓库；这条命令只读取 main 引用，不 clone、不 Commit、不 Push：

```bash
GIT_SSH_COMMAND="ssh -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${credential_root}/known-hosts -i ${credential_root}/deploy-key" \
  git ls-remote --exit-code \
  git@github.com:SDUTVINCI/sdutvinci_content.git \
  refs/heads/main # 预期输出 40 位 SHA、Tab 和 refs/heads/main，退出码为 0
```

成功只证明密钥能读取目标仓库；写权限由 GitHub Deploy Key 页面中的 **Allow write access** 控制，
不要为了“测试写入”创建垃圾 Commit 或 Push。若出现 `Permission denied (publickey)`，依次检查公钥是否
加在内容仓库、是否完整、私钥路径和文件 owner；若出现 host key 错误，重新走可信指纹核验，不能
使用 `StrictHostKeyChecking=no`。

取得不含 `$HOME`、`~` 或 symlink 的真实绝对路径：

```bash
realpath "$credential_root/deploy-key"   # 复制该输出作为 CONTENT_EXPORT_SSH_KEY_FILE 的值
realpath "$credential_root/known-hosts" # 复制该输出作为 CONTENT_EXPORT_KNOWN_HOSTS_FILE 的值
```

当前服务器用户为 `tungchiahui` 时，`.env` 应写成：

```dotenv
CONTENT_EXPORT_SSH_KEY_FILE=/home/tungchiahui/.config/vinci-cms/content-export/deploy-key
CONTENT_EXPORT_KNOWN_HOSTS_FILE=/home/tungchiahui/.config/vinci-cms/content-export/known-hosts
```

不同用户名必须替换为该机 `realpath` 的实际输出。`.env` 不执行 shell 展开，所以不能填写 `$HOME`、
`${HOME}` 或 `~`；这两个值是**宿主机 bind mount 源路径**，也不是容器内的 `/run/secrets/...`。
不要将私钥内容写进 `.env`。本节到此只完成 Deploy Key、known_hosts、只读连通性和两个路径值；
**不要在这里执行整套安装 Dry Run，更不要正式安装**。继续填写第 6～10 节，最后统一执行第 11 节。

轮换时先用**新文件名**生成新密钥、添加并验证新 Deploy Key，再改 `.env` 和重启相应服务，确认 doctor
通过后才从 GitHub 删除旧 Deploy Key；绝不原地覆盖正在使用的私钥。若怀疑私钥泄露，应先在 GitHub
立即删除对应 Deploy Key 并暂停内容 Worker/对账，再签发新密钥，不能等待例行维护窗口。

## 6. GitHub Pull Request 内容导入

| 参数 | 生产环境怎么填 | 允许范围与作用 |
| --- | --- | --- |
| `CONTENT_PR_IMPORT_MODE` | 不使用 PR 导入时保持 `disabled`；完成权限验收后才用 `enabled` | enabled 只允许把选中的 PR diff 导入为草稿/提案，不会自动 Merge、批准或发布。 |
| `CONTENT_PR_IMPORT_REPOSITORY_ID` | 固定 `SDUTVINCI/sdutvinci_content` | 正式环境只接受唯一内容仓库，不能让请求参数选择任意仓库。 |
| `CONTENT_PR_IMPORT_API_URL` | 固定 `https://api.github.com` | 正式环境只允许 GitHub 官方 HTTPS API，禁止内嵌凭据或改成 HTTP。 |
| `CONTENT_PR_IMPORT_GITHUB_TOKEN` | 首次保守部署可留空；也可先写入已验证的 Fine-grained PAT，同时继续保持 mode 为 `disabled` | 预配置便于以后只切换 mode，但 Token 会提前存入宿主机和容器配置，必须按未来实际能力做最小授权。不得复用 SSH Deploy Key、GHCR Token、个人 classic PAT 或代码仓库凭据。 |
| `CONTENT_PR_IMPORT_ROLE_CODES` | 默认 `content_importer` | 允许操作导入功能的 CMS role code，多个值用英文逗号分隔并去空格。不要加入普通编辑角色以图省事。 |
| `CONTENT_PR_IMPORT_MAX_FILE_BYTES` | 默认 `1048576`（1 MiB） | 单文件上限，范围 `1024–5000000` 字节；超限拒绝整个相关动作。 |
| `CONTENT_PR_IMPORT_MAX_FILES` | 默认 `200` | 单 PR 文件数量上限，范围 `1–500`。 |
| `CONTENT_PR_IMPORT_RETRY_ATTEMPTS` | 默认 `3` | GitHub 网络、429 和 5xx 重试次数，范围 `1–5`；不是业务操作无限重试。 |
| `CONTENT_PR_IMPORT_TEST_MODE` | 生产固定 `false` | `true` 只允许 `NODE_ENV=test`，用于回环 mock GitHub；生产启动会拒绝。 |

Token 不要通过 `docker compose config` 的完整输出排障，因为展开后的环境可能包含它。使用
`./vinci doctor` 的脱敏结果和 GitHub 审计日志定位权限问题。

### 6.1 先按使用场景决定是否需要 Token

首次部署无论是否预配 Token，都必须先保持 PR 导入功能关闭。最保守方案是不创建、不填写 Token：

```dotenv
CONTENT_PR_IMPORT_MODE=disabled
CONTENT_PR_IMPORT_REPOSITORY_ID=SDUTVINCI/sdutvinci_content
CONTENT_PR_IMPORT_API_URL=https://api.github.com
CONTENT_PR_IMPORT_GITHUB_TOKEN=
CONTENT_PR_IMPORT_ROLE_CODES=content_importer
CONTENT_PR_IMPORT_TEST_MODE=false
```

空值表示没有 GitHub API 凭据，不是占位符，也不会被第 11 节的占位值检查拒绝。此状态下 CMS 不显示
可用的 PR 导入接口。`CONTENT_EXPORT_SSH_KEY_FILE` 对应的 Deploy Key 只用于 Git 协议导出/对账，
GitHub REST API 不能使用它。

如果维护者明确希望现在完成凭据准备、以后只切换 mode，也允许“Token 已配置，但功能仍关闭”。若未来
要使用读取、评论和显式关闭全部能力，现在就按下表最后一行创建 Token，完成第 6.3 节只读验证，然后
填写：

```dotenv
CONTENT_PR_IMPORT_MODE=disabled
CONTENT_PR_IMPORT_GITHUB_TOKEN=<从密码管理器粘贴的真实Fine-grained-PAT>
```

`disabled` 会让 PR 导入接口 fail closed，不会因为 Token 已存在就自动读取、评论或关闭 GitHub PR。
代价是敏感 Token 会从首次安装开始存在于受保护 `.env` 和应用容器环境中，并开始计算有效期；如果短期
内根本不打算启用，留空仍更安全。

以后确实要启用 PR 导入时，再根据目标能力选择一种权限组合：

| 启用后的能力 | Token | Fine-grained repository permissions |
| --- | --- | --- |
| 公共内容仓库，只做未认证只读导入 | 可留空 | 无；受 GitHub 未认证 API 限流影响，不能评论或关闭 |
| 私有仓库，只读 PR 和文件 | 必需 | `Contents: Read-only`、`Pull requests: Read-only` |
| 读取并允许评论，但不允许关闭 PR | 必需 | `Contents: Read-only`、`Pull requests: Read-only`、`Issues: Read and write` |
| 读取、评论并允许显式关闭 PR | 必需 | `Contents: Read-only`、`Pull requests: Read and write`；`Issues` 保持 No access |

代码读取 `/pulls`、`/pulls/{number}/files` 和 `/contents/{path}`；评论使用 issue comment API，关闭使用
`PATCH /pulls/{number}`。GitHub 官方说明读取仓库文件需要 Contents read，列出 PR 文件需要 Pull
requests read；创建 PR 普通评论可使用 Issues write 或 Pull requests write，而关闭 PR 需要 Pull
requests write。Vinci 没有调用 Merge API，不能为了省事授予 `Contents: Read and write`、
`Administration` 或组织级权限。

### 6.2 创建仅限内容仓库的 Fine-grained PAT

只有决定启用上表某个需要 Token 的场景时才执行：

1. 登录将长期拥有目标内容仓库权限的 GitHub 账号，打开头像 → **Settings** →
   **Developer settings** → **Personal access tokens** → **Fine-grained tokens** →
   **Generate new token**。不要选择 Tokens (classic)。
2. Token name 填可审计名称，例如 `vinci-pr-import-debian-20260802`；Description 写明服务器、用途和
   轮换负责人，不填写 IP 密码或其他秘密。
3. Expiration 建议先选 `90 days` 或组织允许的更短期限，并在维护日历登记到期前轮换。Token 到期
   不影响 Deploy Key 导出，但会让启用的 PR API 操作失败。
4. Resource owner 选择 `SDUTVINCI`；Repository access 选择 **Only select repositories**，且只选
   `sdutvinci_content`。不能选 All repositories，也不能把 `sdutvinci_web` 加进去。
5. Repository permissions 严格按第 6.1 节对应行选择；Account permissions 和 Organization
   permissions 全部保持 **No access**。GitHub 自动显示的 Metadata read 无需额外扩大。
6. 点击 **Generate token**。若组织要求审批，Token 在组织 Owner 批准前可能只能读取公共资源；等待
   `SDUTVINCI` Owner 在 Personal access token 请求中审批，不能改用 classic PAT 绕过策略。
7. Token 只显示一次，直接保存进密码管理器。不要粘贴到聊天、截图、shell history、GitHub issue、
   Deploy Key 页面或 Docker 登录。

GitHub Fine-grained PAT 可以限定单个资源所有者、精确仓库和精确权限；它仍绑定创建者账号，账号失去
仓库访问权限时 Token 也会失效。创建和组织审批规则见
[GitHub Personal Access Token 官方教程](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
与 [组织 PAT 策略](https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization)。

### 6.3 不泄露 Token 的只读权限验证与 `.env` 写入

以下流程适用于已经决定预配置或启用并创建了 Token 的情况。GitHub 页面显示权限正确并不等于 Token
已经可用：它还可能复制不完整、尚未通过组织审批、选错 Resource owner/仓库或已经失效。下面分别
读取固定内容文件和 PR 列表，以验证 `Contents: Read` 与 `Pull requests: Read`。它不评论、不关闭、
不 Merge，因此不会验证写权限；写权限留到安装后在专门测试 PR 上显式验收。

Token 不会写入命令参数、临时文件或输出，只在当前 shell 的隐藏输入变量中短暂存在，两个请求完成后
立即 `unset`。关闭 shell xtrace 后执行：

```bash
set +x # 防止当前 shell 若曾启用调试时回显后续敏感展开
read -r -s -p 'Content PR import fine-grained token: ' content_pr_token
printf '\n'
github_api_status() {
  local api_url="$1"
  {
    printf 'header = "Authorization: Bearer %s"\n' "$content_pr_token"
    printf 'header = "Accept: application/vnd.github+json"\n'
    printf 'header = "X-GitHub-Api-Version: 2022-11-28"\n'
  } | curl --config - --silent --show-error --output /dev/null \
    --write-out '%{http_code}' "$api_url"
}
contents_status="$(github_api_status \
  'https://api.github.com/repos/SDUTVINCI/sdutvinci_content/contents/.vinci/snapshot.json?ref=main')"
pulls_status="$(github_api_status \
  'https://api.github.com/repos/SDUTVINCI/sdutvinci_content/pulls?state=all&per_page=1')"
unset -f github_api_status
unset content_pr_token
if [ "$contents_status" = 200 ] && [ "$pulls_status" = 200 ]; then
  printf 'PASS：Contents read 与 Pull requests read 均可用。\n' # 只输出结论，不输出 Token 或响应正文
else
  printf 'FAIL：Contents HTTP %s；Pull requests HTTP %s。\n' \
    "$contents_status" "$pulls_status" >&2 # 状态码不是秘密，用于区分 401/403/404
  false
fi
unset contents_status pulls_status
```

预期只看到一行 `PASS`。`read -s` 粘贴 Token 时终端不会显示字符，这是正常保护，不是键盘失效。
验证结束后 shell 已经忘记 Token；应从密码管理器把同一个值写入 `.env`，不要试图从 history 或上述
变量恢复。

验证后使用不会把内容回显到共享终端的受控编辑器或密码管理流程，把刚才保存在密码管理器中的值写入。
准备立即启用时使用：

```dotenv
CONTENT_PR_IMPORT_MODE=enabled
CONTENT_PR_IMPORT_GITHUB_TOKEN=<从密码管理器粘贴的真实Fine-grained-PAT>
```

像本次部署一样只预配置、暂不启用时使用：

```dotenv
CONTENT_PR_IMPORT_MODE=disabled
CONTENT_PR_IMPORT_GITHUB_TOKEN=<从密码管理器粘贴的真实Fine-grained-PAT>
```

随后立即执行 `chmod 600 .env`，但仍要继续完成第 7～10 节，不能在第 6 节提前正式安装。不要用
`source .env`、`grep TOKEN .env`、`docker compose config` 的完整输出或 `curl -v` 验证。如果只读请求
返回 `401`，Token 值无效或已过期；`403` 常见于权限、组织策略或审批未完成；`404` 可能是 Resource
owner/仓库选择错误，也可能是 GitHub 对无权限私有资源的遮盖响应。修正 GitHub 授权后重新执行只读
验证，不要临时扩大到 All repositories。

评论/关闭权限不要用测试评论或随便关闭真实 PR 来验证；安装和角色验收后，在专门测试 PR 上通过 CMS
显式动作验证并检查审计记录。轮换时先创建新 Token、完成两个只读请求、更新 `.env` 并复验，再删除
旧 Token。怀疑泄露时立即在 GitHub Fine-grained tokens 页面撤销并保持
`CONTENT_PR_IMPORT_MODE=disabled`，直到新 Token 完成审批和验证。

### 6.4 将来只切换 mode 并受控重载

预配置方案下，将来启用前先重新执行第 6.3 节两个只读请求，确认 Token 未过期且组织审批仍有效；然后
只把 `.env` 中这一行改为：

```dotenv
CONTENT_PR_IMPORT_MODE=enabled
```

`.env` 不是运行中容器的热加载配置，保存文件本身不会改变当前应用。必须用统一入口在当前不可变镜像
上完成一次蓝绿重载，不能手工 `docker restart`：

```bash
chmod 600 .env # 再次确认包含 Token 的配置只允许 owner 读写
current_deployment_sha="$(awk -F= '$1 == "commit" { print $2; exit }' .deploy/current)"
[[ "$current_deployment_sha" =~ ^[0-9a-f]{40}$ ]] # 预期成功：只读取非敏感的当前部署 SHA
./vinci update "$current_deployment_sha" # 同一 SHA 重新创建候选槽，读取新 env、健康检查后切换网关
./vinci status # 预期仍是同一 SHA，但活动 slot 已切换且容器健康
./vinci doctor # 预期以 0 退出；输出不得包含 Token
unset current_deployment_sha
```

更新失败会保留原活动槽，不应改用 `docker compose up`、手工重启、关闭权限校验或把 Token 打到日志。
如果决定再次停用，也把 mode 改回 `disabled` 并用同样的当前 SHA 蓝绿重载；只改 `.env` 不足以停用
已运行容器中的功能。

## 7. S3 兼容对象存储 / 腾讯云 COS

这些字段是生产必填项。即使暂时不上传图片，`./vinci doctor` 也会执行 HeadBucket，并核对数据库
中已有对象；不能填假地址绕过。Bucket 应开启版本控制、防误删，并使用仅限目标 prefix 的独立
凭据。

| 参数 | 生产环境怎么填 | 允许范围与作用 |
| --- | --- | --- |
| `S3_ENDPOINT` | 供应商给出的 S3 API endpoint，例如 `https://s3-api.example.com` | 必须是有效 URL。它用于 SDK API 请求，不是图片公网 CDN 地址。COS 应按所选 region 使用官方 S3 兼容 endpoint。 |
| `S3_REGION` | Bucket 实际 region，例如供应商控制台显示的 region code | 必须与 Bucket 和签名区域一致，不能填中文地域名称。 |
| `S3_BUCKET` | 专用于本实例的 Bucket 名 | 只填名称，不带 `s3://`、endpoint、路径或 prefix。 |
| `S3_ACCESS_KEY_ID` | 专用最小权限访问 ID | 至少允许目标 Bucket/prefix 的上传、读取和 doctor 所需 HeadBucket/HeadObject；不要使用账号主密钥。 |
| `S3_SECRET_ACCESS_KEY` | 与上面 ID 配对的 secret | 只存密码库和 `.env`，轮换时两项一起更新并复验，不打印到日志。 |
| `S3_PUBLIC_BASE_URL` | 浏览器访问图片的 HTTPS 基址，例如 `https://img.example.com` | 不含 object key；程序会自动追加 `/<encoded-key>` 并去掉末尾 `/`。已有数据库 URL 必须与该基址一致。 |
| `S3_FORCE_PATH_STYLE` | AWS/COS 通常按供应商要求填 `false`；MinIO 等可能要求 `true` | `false` 使用 virtual-hosted 风格，`true` 使用 path-style。填错通常表现为签名、DNS 或 Bucket 404。 |
| `S3_KEY_PREFIX` | 默认 `images`，多实例可用如 `vinci-prod/images` | 不能以 `/` 开头/结尾；每段只允许字母、数字、`_`、`-`，禁止空段、`.`、`..`。上线后修改不会迁移旧对象。 |
| `S3_DOCTOR_MAX_OBJECTS` | 默认 `10000`，应不小于数据库媒体记录总数 | 范围 `1–100000`。doctor 超过该数量会 fail closed，避免一次无界 HeadObject；扩容前评估执行时间和 API 成本。 |
| `CMS_IMAGE_MAX_BYTES` | 默认 `10485760`（10 MiB） | 原始上传大小上限，范围 `1024–52428800` 字节。反向代理请求体上限还必须大于它。 |
| `CMS_IMAGE_MAX_WIDTH` | 默认 `2560` | WebP 输出最大宽度，范围 `320–8192` 像素；图片按比例缩小，不盲目放大。 |
| `CMS_IMAGE_MAX_HEIGHT` | 默认 `2560` | WebP 输出最大高度，范围 `320–8192` 像素。 |
| `CMS_IMAGE_WEBP_QUALITY` | 默认 `82` | WebP 质量，范围 `1–100`；越高文件通常越大，不建议直接设 100。 |

`S3_ENDPOINT` 与 `S3_PUBLIC_BASE_URL` 通常不是同一个地址：前者给服务器签名读写，后者给浏览器
公开读取。不要把带 secret 的签名 URL 填为 public base。

## 8. Git 部署、自动更新和部署缓存

| 参数 | 生产环境怎么填 | 允许范围与作用 |
| --- | --- | --- |
| `DEPLOY_GIT_REMOTE_URL` | `git remote get-url origin` 的精确结果，例如 `https://github.com/SDUTVINCI/sdutvinci_web.git` | 自动/人工部署都会比较字符串；不一致即拒绝。URL 不能内嵌 Token 或密码，服务器 remote 只读。 |
| `AUTO_DEPLOY_ENABLED` | 首次固定 `false`；人工部署与回滚验收后才改 `true` | timer 始终安装，但 false 时只记录“未启用”并退出。true 后每分钟检查 origin/main，只部署当前线上 Commit 的快进后继和已存在的两种不可变镜像。 |
| `DEPLOY_CACHE_CLEANUP_ENABLED` | 建议保留 `true` | 每次部署前清理可重建 build cache 和未引用旧 SHA 镜像；只接受 `true`/`false`，不会清 volume/数据库。磁盘排障时也不要改成 system prune。 |
| `DEPLOY_CACHE_KEEP_IMAGES` | 默认 `3` | 每个 runtime/operations 仓库至少保留的最近 SHA 数，范围 `1–100`；活动、失败和已验证回滚版本额外保护。 |
| `DEPLOY_CACHE_RETENTION_HOURS` | 默认 `168`（7 天） | 旧镜像/可重建缓存的年龄门槛，范围 `1–8760` 小时；保留数量与引用保护仍优先。 |

启用自动部署时只编辑这一行并复验，不需要重装 timer：

```dotenv
AUTO_DEPLOY_ENABLED=true
```

然后执行 `chmod 600 .env`、`./vinci doctor`，等待下一轮 timer。不要手工执行
`./vinci update --automatic`；人工发布使用 `./vinci update <完整40位SHA>`。

## 9. PostgreSQL 备份、磁盘门禁与分层保留

| 参数 | 生产环境怎么填 | 允许范围与作用 |
| --- | --- | --- |
| `BACKUP_ROOT` | 例如 `/var/backups/vinci-cms` | 必须是仓库外的安全绝对目录，owner 为安装用户、权限 `0700`。安装器会用 sudo 创建；不要指向 Home 根、symlink、共享未知目录或 Docker volume 根。 |
| `BACKUP_RETRY_ATTEMPTS` | 默认 `3` | `pg_dump` 单次任务的总尝试次数，整数且至少 `1`。全部失败时不推进 latest-success，也不清旧备份。 |
| `BACKUP_RETRY_DELAY_SECONDS` | 默认 `2` | 尝试间等待秒数，非负整数。它不是无限后台重试。 |
| `BACKUP_MIN_FREE_BYTES` | 默认 `1073741824`（1 GiB） | 低于此值记录 `BACKUP_DISK_LOW`，但只要仍高于 critical 可继续尝试备份。必须大于等于 critical。 |
| `BACKUP_CRITICAL_FREE_BYTES` | 默认 `536870912`（512 MiB） | 低于此值立即拒绝新备份并记录 critical 告警；doctor 也会失败。不要为“先跑起来”把它设成 0。 |
| `BACKUP_RETENTION_DAILY_DAYS` | 默认 `7` | 上海时区按日保留窗口，整数 `1–3660`。每个日 bucket 保留代表备份。 |
| `BACKUP_RETENTION_WEEKLY_WEEKS` | 默认 `4` | 按周保留窗口，整数 `1–3660`。 |
| `BACKUP_RETENTION_MONTHLY_MONTHS` | 默认 `12` | 按月保留窗口，整数 `1–3660`。 |

三层保留不是简单的“最多 N 份”。最新备份、latest-success、最新完成隔离可恢复验证的备份以及
全部 `.vinci-locked` 备份始终保护。增大保留期前先估算磁盘，缩短前先执行
`./vinci backup-prune --dry-run`。

## 10. 内容对账材料、实例迁移包和日志保留

| 参数 | 生产环境怎么填 | 允许范围与作用 |
| --- | --- | --- |
| `CONTENT_SNAPSHOT_RETENTION_DAYS` | 默认 `30` | 对账生成的灾备内容 snapshot 保留天数，正整数。它不能替代 PostgreSQL 完整备份。 |
| `RECONCILIATION_REPORT_RETENTION_DAYS` | 默认 `90` | 对账 JSON 报告保留天数，正整数；报告用于审计差异/hash。 |
| `RECONCILIATION_TEMP_RETENTION_DAYS` | 默认 `1` | 已标记的对账临时 snapshot 保留天数，正整数。未知文件、错误 owner、symlink 会让清理 fail closed。 |
| `INSTANCE_EXPORT_ROOT` | 例如 `/var/backups/vinci-cms-instances` | V2→V2 实例迁移包根，仓库外安全绝对目录、owner 为安装用户、权限 `0700`。不要与 `BACKUP_ROOT` 使用同一目录。 |
| `INSTANCE_RETENTION_DAYS` | 默认 `30` | 未锁定实例迁移包的保留天数，整数 `1–3660`；带 `.vinci-locked` 的包继续保护。 |
| `VINCI_LOG_ROOT` | 例如 `/var/log/vinci-cms` | 动态 systemd service 的日志根，安装器创建为当前用户所有、权限 `0750`。logrotate 按日、30 份或 100 MiB 轮转。不得写入任何秘密。 |

`CONTENT_RECONCILIATION_ROOT` 的保留参数作用于对账材料；`INSTANCE_EXPORT_ROOT` 作用于整机迁移
包；`BACKUP_ROOT` 作用于 PostgreSQL dump。三者不能混用，也不要靠手工 `rm -rf` 代替
`./vinci maintenance --dry-run/--apply`。

## 11. 首次部署前的最终核对

只有完成第 2～10 节，并逐项确认 `.env` 中不再存在模板路径、示例密码或待替换值后，才执行本节。
以下检查不会打印 `.env` 的具体值：

```bash
test -f .env && test ! -L .env     # 必须是现有普通路径且不是 symlink
test "$(stat -c '%a' .env)" = 600 # 必须严格为 0600
if grep -Eq 'replace-|/absolute/path|<[^>]+>' .env; then
  printf '错误：.env 仍包含模板占位值；请继续逐项填写，不要安装。\n' >&2
  false
fi # 预期无输出；只返回是否命中，不打印可能含秘密的整行
docker compose config --quiet # 预期无输出：验证基础 Compose 的必填项和语法
docker compose -f compose.yaml -f compose.content-export.yaml \
  --profile content-export config --quiet # 预期无输出：验证内容导出 overlay 和宿主机文件路径
PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH" \
  ./vinci install --dry-run # 最后才执行整体验证；不启动、不迁移、不安装 timer、不 Push
```

若旧版本入口报告 `logrotate: command not found`，先运行 `/usr/sbin/logrotate --version`；能显示版本
说明只是当前 SSH 终端 PATH 不完整，上面的单次 PATH 已兼容，不要修改 `.bashrc` 或建立同名软链接。
新版统一入口也会受控检查 `/usr/sbin/logrotate`。

随后人工确认：

- `APP_BIND_ADDRESS=127.0.0.1`、`APP_PORT=3000`，1Panel 仍负责 18080 入口；
- `NUXT_PUBLIC_SITE_URL` 是浏览器真实 origin，HTTPS 时 `CMS_SECURE_COOKIES=true`；
- 数据库四项相互一致，`TEST_DATABASE_URL` 与生产完全隔离；
- 两个镜像仓库和 40 位 SHA 已由 CI 发布；
- S3/COS 是真实专用 Bucket/prefix，版本控制已开启；
- 内容仓库 key/known_hosts 是独立普通文件且权限正确；
- 自动部署首次保持关闭，备份/实例/日志目录均在仓库外。

任何检查失败都应修正对应配置后重试；不要关闭 CSRF、限流、Secure Cookie、路径/owner 校验，
也不要用假 S3、生产测试库或宽权限凭据让 doctor 暂时变绿。

全部检查通过时，只能得出“`.env` 与宿主机已具备正式安装条件”，此时仍不会有应用容器、数据库
volume、部署状态、备份目录或 timer。因此不要在这里运行 `./vinci status`/`./vinci doctor` 并把
它们的安装前失败当成故障，也不要自行拼接安装命令。下一步只按
[`DEPLOYMENT.md` 第 2 节](../DEPLOYMENT.md#2-全新空库正式部署) 执行资源占用复核、
`./vinci install --initialize=empty` 和安装后验收。
