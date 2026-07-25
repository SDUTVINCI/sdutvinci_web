# CMS 阶段 1～2 运行说明

本文覆盖 PostgreSQL、身份认证、成员管理和文章只读管理。文章编辑、草稿、发布和图片上传尚未开放。

## 1. 环境变量

复制 `.env.example` 为本机 `.env`，至少修改：

```dotenv
DATABASE_URL=postgresql://用户名:密码@127.0.0.1:5432/数据库名
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

后台登录地址为 `http://localhost:3000/cms/login`，使用账号 ID 和密码登录，不使用邮箱登录。登录后可访问工作台、文章只读列表和预览、成员列表及个人资料；管理员可以创建和维护成员姓名、头像。管理员用户管理 API 位于 `/api/cms/admin/users`，用户管理界面将在后续阶段完善。

## 5. 验证

类型检查和构建不需要连接数据库：

```bash
npm run typecheck
npm run build
```

CMS 集成测试必须指向专用测试数据库，测试会清空其中的 CMS 表，严禁连接生产数据库：

```bash
DATABASE_URL=postgresql://vinci:vinci_test@127.0.0.1:55432/vinci_cms \
CMS_AUTH_SECRET=test-only-secret-with-at-least-32-characters \
npm run test:cms
```
