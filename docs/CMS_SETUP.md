# CMS 阶段 1～4 运行说明

本文覆盖 PostgreSQL、身份认证、成员管理、文章只读索引、Markdown 编辑器、数据库草稿、审核流程、编辑锁和正式版本冲突检查。正式发布、Git 写入和图片上传尚未开放。

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
```

可使用 `openssl rand -base64 48` 生成 `CMS_AUTH_SECRET`。生产环境必须把 `CMS_SECURE_COOKIES` 设为 `true`，并把 `NUXT_PUBLIC_SITE_URL` 设为实际 HTTPS Origin。真实密钥不得提交到 Git。

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
- 管理员在 `/cms/reviews` 查看 Frontmatter 和正文差异，填写原因驳回或审核通过。审核通过只产生 `approved` 状态，不会正式发布。
- 提交和审核通过前都会读取当前正式 Markdown 计算实时哈希。发现冲突时必须撤回并手动整理差异，再明确确认最新正式版本为新基线；系统不会自动合并。
- 本阶段没有正式发布、Markdown 写入、Git 操作或图片上传按钮。

## 6. 验证

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

测试只读取 `TEST_DATABASE_URL`，并要求数据库名称包含独立的 `test` 单词；未提供时全部数据库集成测试会跳过。即使当前环境中存在普通 `DATABASE_URL`，测试也不会使用它。
