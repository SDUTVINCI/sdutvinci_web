# CMS 阶段 1～6 运行说明

本文覆盖 PostgreSQL、身份认证、成员管理、文章索引、Markdown 编辑器、数据库草稿、审核流程、编辑锁、正式版本冲突检查、隔离 Git 工作区中的正式发布和历史恢复，以及 WebP 图片处理和 S3 兼容对象存储。生产自动部署属于后续阶段。

## 1. 环境变量

复制 `.env.example` 为本机 `.env`，至少修改：

```dotenv
DATABASE_URL=postgresql://用户名:密码@127.0.0.1:5432/数据库名
TEST_DATABASE_URL=postgresql://测试用户名:测试密码@127.0.0.1:55432/vinci_cms_test
DATABASE_POOL_MAX=10
DATABASE_SSL=false
CMS_AUTH_SECRET=至少32字符的随机密钥
CMS_SESSION_COOKIE=vinci_cms_session
CMS_SESSION_TTL_HOURS=168
CMS_SECURE_COOKIES=false
NUXT_PUBLIC_SITE_URL=http://localhost:3000
CMS_CONTENT_ROOT=content
CMS_GIT_WORKTREE=/var/lib/vinci-cms/worktree
CMS_GIT_REMOTE_URL=git@github.com:SDUTVINCI/sdutvinci_web.git
CMS_GIT_REMOTE=origin
CMS_GIT_BRANCH=main
CMS_GIT_AUTHOR_NAME=Vinci CMS
CMS_GIT_AUTHOR_EMAIL=cms@localhost
CMS_GIT_SSH_KEY_PATH=/run/secrets/cms_git_ssh_key
S3_ENDPOINT=https://replace-with-s3-endpoint
S3_REGION=replace-with-region
S3_BUCKET=replace-with-bucket
S3_ACCESS_KEY_ID=replace-with-access-key
S3_SECRET_ACCESS_KEY=replace-with-secret-key
S3_PUBLIC_BASE_URL=https://replace-with-public-image-domain
S3_FORCE_PATH_STYLE=false
S3_KEY_PREFIX=images
CMS_IMAGE_MAX_BYTES=10485760
CMS_IMAGE_MAX_WIDTH=2560
CMS_IMAGE_MAX_HEIGHT=2560
CMS_IMAGE_WEBP_QUALITY=82
```

可使用 `openssl rand -base64 48` 生成 `CMS_AUTH_SECRET`。生产环境必须把 `CMS_SECURE_COOKIES` 设为 `true`，并把 `NUXT_PUBLIC_SITE_URL` 设为实际 HTTPS Origin。`S3_PUBLIC_BASE_URL` 应指向能公开读取对象的 Bucket 域名、CDN 域名或包含 Bucket 的路径前缀；API Endpoint 与公开访问域名必须分开配置。真实密钥不得提交到 Git。

## 2. 初始化数据库

先创建空 PostgreSQL 数据库，再执行仓库内已提交的 migration：

```bash
npm run db:migrate
```

该命令会自动读取项目根目录的 `.env`，可以重复执行；migration 会初始化 `admin` 和 `member` 两个系统角色。

只有修改了 `server/db/schema.ts` 后才运行 `npm run db:generate` 生成新的 SQL。生产环境不得临时生成 migration。

迁移后同步成员和文章索引：

```bash
npm run cms:content:sync
```

该命令会为尚无 ID 的成员档案写入稳定小写 ID，并扫描 `content/news` 与 `content/wiki`。它不会修改文章、删除文章或执行 Git 操作。

## 3. 创建首个管理员

```bash
npm run cms:admin
```

命令只要求输入稳定账号 ID（例如 `dongjiahui`）和密码，并自动读取项目根目录的 `.env`。密码只允许在交互式终端中输入，输入会隐藏，并且不会从命令参数或环境变量读取。数据库中已有管理员时，初始化命令会拒绝继续。姓名、头像等资料从同 ID 的成员档案读取。后续用户应通过管理员 API 创建，不应再次运行首次初始化。

## 4. 启动与访问

```bash
npm run dev
```

后台登录地址为 `http://localhost:3000/cms/login`，使用账号 ID 和密码登录，不使用邮箱登录。登录后可访问工作台、文章、草稿、成员列表及个人资料；管理员还可访问 `/cms/reviews` 审核内容，并创建和维护成员姓名、头像。管理员用户管理 API 位于 `/api/cms/admin/users`，用户管理界面将在后续阶段完善。

## 5. 编辑与草稿

- 在文章详情点击“编辑草稿”，会创建或恢复当前账号对该文章的草稿。
- 在文章列表点击“新建文章草稿”，只会创建 PostgreSQL 记录，不会在 `content/` 中创建文件。
- `/cms/drafts` 列出当前账号的全部草稿，可在刷新或重新登录后继续编辑。
- 打开可编辑草稿时自动获取编辑锁，每 20 秒续期；90 秒未续期后锁自动失效。站内正常离开和浏览器完成关闭时会主动释放。
- 其他用户持有同一文章的锁时页面保持只读并显示持有人；管理员可填写可选原因后强制接管，接管操作写入审计日志。
- 编辑页约 1.2 秒无操作后自动保存，也可以手动保存。
- 所有文章都可以进入基于 Milkdown Crepe 的混合可视化模式；原始 HTML、Vue 组件、Jekyll/MDC 等扩展语法显示为标明类型的只读保护区域，周围的普通 Markdown 仍可编辑。保护区域本身需要切换到源码模式修改。
- 草稿可提交审核；待审核内容不可编辑，提交者可在审核结束前撤回。被驳回或撤回的草稿需要显式点击“继续编辑”才能恢复。
- 管理员在 `/cms/reviews` 查看 Frontmatter 和正文差异，填写原因驳回或审核通过。审核通过后可确认新文章路径并正式发布。
- 提交和审核通过前都会读取当前正式 Markdown 计算实时哈希。发现冲突时必须撤回并手动整理差异，再明确确认最新正式版本为新基线；系统不会自动合并。
- 正式发布会再次同步远端并校验基线，在独立工作区原子写入 Markdown，再 commit 和 push。只有 push 成功才将草稿标为 `published`。
- Push 失败会记录原因，草稿保持 `approved`，管理员修复 Git 或网络问题后可在原审核页重试。
- 文章详情的“版本历史”可查看和比较历史 Markdown；管理员恢复历史版本时会产生一个新提交，不删除已有历史。
- `CMS_GIT_WORKTREE` 必须是部署目录之外的独立 clone。服务账号需要该目录的读写权限和目标分支的非强制推送权限；SSH 私钥建议只读挂载并由 `CMS_GIT_SSH_KEY_PATH` 指向。
- 阶段 5 不自动更新正在运行的网站目录。Push 后由现有人工部署方式拉取远端最新提交；生产 GitHub Actions 自动部署在阶段 8 实现。
- 草稿为可编辑状态且当前页面持有有效编辑锁时，可选择图片、把图片拖入编辑区，或直接粘贴截图。服务端接受 JPEG/JPG、PNG、WebP、GIF，并统一转换为 WebP；动态 GIF 会保留动画。若这些格式的文件扩展名标错，以服务端安全解码出的真实格式为准。
- 图片成功上传后会直接插入 Markdown；正文变化继续沿用自动保存。图片关联草稿，但二进制只保存在 S3 兼容对象存储中。

## 6. 首次准备发布工作区

首次发布时服务会在 `CMS_GIT_WORKTREE` 不存在的情况下自动 clone。若目录已存在，则必须满足：

- 是独立 Git clone，且工作区无未提交修改；
- 配置的 remote URL 与 `CMS_GIT_REMOTE_URL` 完全一致；
- 目标分支可 fetch，并允许以 fast-forward 方式 push；
- 与 `CMS_CONTENT_ROOT` 不相同且互不包含。

生产环境建议提前用运行 CMS 的同一系统账号执行一次只读连通性检查：

```bash
git ls-remote "$CMS_GIT_REMOTE_URL" "$CMS_GIT_BRANCH"
```

不要把私钥、访问令牌或真实远端凭据写入仓库。

## 7. S3 兼容图片存储

对象存储凭据至少需要对配置 Bucket 的 `PutObject` 权限。服务在数据库记录失败或上传后编辑租约失效时会尝试 `DeleteObject`，因此建议同时授予受控图片前缀的 `DeleteObject` 权限。Bucket 或 CDN 必须允许通过 `S3_PUBLIC_BASE_URL/<对象 key>` 公开读取图片。

- AWS S3、腾讯云 COS 等虚拟主机风格服务通常使用 `S3_FORCE_PATH_STYLE=false`。
- MinIO 等本地兼容服务常使用 `S3_FORCE_PATH_STYLE=true`，并把 `S3_PUBLIC_BASE_URL` 配置为包含 Bucket 的公开路径。
- `S3_KEY_PREFIX` 只允许安全路径分段，不接受 `/` 开头、尾随 `/`、`.` 或 `..`。
- 默认最大原图为 10 MiB，输出最长边为 2560 px、WebP 质量为 82；可按部署资源和图片策略调整对应环境变量。
- 第一版不提供媒体列表、搜索、删除或复用界面；这些不属于阶段 6。

应用 migration `0008_aberrant_titanium_man.sql` 后会创建 `media_assets`，记录 URL、对象 key、上传者、上传时间、关联草稿和必要的图片元数据，不保存图片二进制。

## 8. 验证

类型检查和构建不需要连接数据库：

```bash
npm run typecheck
npm run build
```

CMS 集成测试必须指向专用测试数据库，测试会清空其中的 CMS 表，严禁连接生产数据库：

```bash
TEST_DATABASE_URL=postgresql://vinci:vinci_test@127.0.0.1:55432/vinci_cms_test \
CMS_AUTH_SECRET=test-only-secret-with-at-least-32-characters \
npm run test:cms
```

测试只读取 `TEST_DATABASE_URL`，并要求数据库名称包含独立的 `test` 单词；未提供时全部数据库集成测试会跳过。即使当前环境中存在普通 `DATABASE_URL`，测试也不会使用它。阶段 5 测试会自行创建临时本地裸 Git 远端、独立工作区和拒绝推送 hook，不会连接或推送真实 GitHub 仓库。阶段 6 测试使用内存中的模拟 S3 客户端验证转换、上传参数、失败补偿和密钥隔离，不会访问真实对象存储。
