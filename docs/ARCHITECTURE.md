# Vinci 网站与 CMS 架构

## 1. 文档状态

本文记录网站与 CMS 的长期架构约束。阶段 0 于 2026-07-25 完成首次技术方案确认，阶段 1 于同日落地数据库与身份认证基础。后续只有在发生重大架构调整时才修改本文，并应同步在 `docs/CODEX_HANDOVER.md` 追加说明。

当前已接入 PostgreSQL、登录和权限骨架；尚未接入编辑器、对象存储或 Git 发布。

## 2. 当前项目审查结论

### 2.1 技术栈与构建

- Nuxt 4.5.x、Vue 3.5.x、TypeScript；根 `tsconfig.json` 使用 Nuxt 4 推荐的 project references，具体配置由 Nuxt 生成。
- Nuxt Content 3.15.x，内容构建时使用 SQLite/`better-sqlite3` 索引；它不承担 CMS 业务数据库职责。
- npm 与 `package-lock.json` v3，当前开发机为 Node.js 24。
- `npm run build` 生成 Nitro `node-server`，同时预渲染前台路由。因此项目可以在同一 Nuxt 应用中增加服务端 API 和动态 CMS 页面。
- `prebuild` 和 `pregenerate` 均执行 `scripts/wiki-check.mjs`。
- 当前已有 `server/` CMS API、页面路由保护和数据库 migration；Docker 与 CI/CD 配置留到后续阶段。

### 2.2 前台与内容

- 前台页面位于 `app/pages/`，统一页头和页脚已迁移到 `app/layouts/default.vue`；CMS 使用独立 layout。
- 内容集合由 `content.config.ts` 定义：
  - `members`：32 个成员文件；
  - `news`：2 个新闻文件；
  - `wiki`：226 个 Wiki 文件。
- Wiki 路径通过 `transformers/wiki-pinyin-path.ts` 和 `utils/wiki-content-meta.ts` 派生；CMS 不得自行复制一套不同的路径算法。
- 成员文件目前以中文姓名作为文件名及前台查找依据，Frontmatter 还没有稳定成员 ID。
- 当前文章 Frontmatter 并不统一：
  - Wiki 主要只有 `title`；
  - 新闻使用 `title`、`date`、`author`、`tags`、`image`、`bvid`、`summary`；
  - 成员使用 `name`、`image`、`role`、`type`、`time`、`advisor`、`grade`、`affiliation`、`links`。
- 内容中存在 Markdown 之外的扩展语法，包括 `<NuxtLink>` 和少量 `{% include ... %}`。任何可视化编辑器都不得静默丢弃这些语法。

### 2.3 Nuxt Studio

阶段 1 已移除 `nuxt-studio`，避免它成为绕过 CMS 权限和审核的第二条内容写入通道。普通 `npm run build` 不再依赖 GitHub 仓库环境变量。

## 3. 目标系统总览

```text
浏览器
  ├─ 前台页面（Nuxt Content 读取正式 Markdown）
  └─ /cms 页面
       └─ /api/cms/*（Nitro）
            ├─ PostgreSQL（用户、会话、草稿、审核、锁、审计）
            ├─ S3 兼容存储（WebP 图片）
            └─ CMS 独立 Git 工作区（唯一 Markdown 写入口）
                    └─ GitHub
                         └─ GitHub Actions 构建并部署运行目录
```

系统边界：

- Nuxt 前台、CMS 页面和 Nitro API 保持在同一个项目、同一个应用镜像中。
- 正式文章正文的唯一数据源是 GitHub 中的 Markdown。
- PostgreSQL 保存业务状态和辅助索引，不成为正式文章正文的线上数据源。
- 图片正文存放在 S3 兼容对象存储，PostgreSQL 只记录元数据。
- 运行中的部署目录只读；CMS 只在独立 Git 工作区写 Markdown。

## 4. 目录规划

目录按阶段逐步创建；阶段 1 已建立如下基础：

```text
app/
  components/cms/       CMS 专用组件
  composables/          CMS 客户端会话状态与 API 封装
  layouts/
    default.vue         现有前台壳
    cms.vue             登录后的后台壳
    cms-auth.vue        登录页壳
  middleware/
    cms-auth.ts         页面导航保护（只改善体验，不替代服务端鉴权）
    cms-admin.ts
  pages/cms/
    login.vue
    index.vue
    articles/
    members/
    reviews/
    profile.vue
server/
  api/cms/              CMS HTTP API
  db/
    schema.ts           Drizzle 表定义
    migrations/         已提交的 SQL migration
  services/             auth、content、draft、review、git、storage
  utils/                校验、路径、错误与权限工具
scripts/
  cms-admin.ts          首个管理员初始化入口
  cms-migrate.ts        migration 入口
```

前台查询和 Wiki 路径派生继续复用现有 `content.config.ts`、`transformers/` 与 `utils/`。CMS 代码不得让浏览器直接访问文件系统、数据库、Git 或对象存储密钥。

## 5. 技术选型

### 5.1 PostgreSQL 与数据库访问

采用 PostgreSQL + Drizzle ORM + `pg`（node-postgres），migration 由 Drizzle Kit 生成并将 SQL 文件提交到仓库。

理由：

- Drizzle 原生支持 PostgreSQL 和 `node-postgres`，与 Nitro 的 Node.js 运行目标匹配。
- schema 与查询保持 TypeScript 类型，仍可审阅和手工验证生成的 SQL。
- migration 是普通、可追踪、可在空数据库重放的 SQL，不依赖生产数据库反向同步。
- 不复用 Nuxt Content 的 SQLite 索引；两者职责完全不同。

约束：

- 生产启动不自动生成 migration，只执行仓库中已审核的 migration。
- 所有时间字段使用 PostgreSQL `timestamptz`，应用层统一以 UTC 传输。
- 主键使用 UUID；对外不暴露自增序号。
- 业务状态使用数据库约束或受控枚举，并在 migration 中显式变更。

### 5.2 登录和会话

采用“服务端有状态会话”，不采用浏览器持有长期 JWT：

- 密码使用 Argon2id 单向哈希，每个密码使用库生成的独立 salt。
- 登录成功后生成至少 256 bit 的随机会话令牌；浏览器只保存原始令牌，数据库只保存 SHA-256 摘要。
- Cookie 设置 `HttpOnly`、`SameSite=Lax`、限定 Path；生产环境必须启用 `Secure`。
- 退出、禁用用户、改密和管理员撤销操作都能立即删除会话。
- 所有写 API 进行同源校验并使用 CSRF token；页面中间件只负责跳转，API 必须再次执行会话和权限校验。
- 登录失败保护、速率限制和完整安全回归在阶段 9 完善，但阶段 1 就不得明文存储密码或信任客户端角色。

`CMS_AUTH_SECRET` 用于 CSRF/一次性安全流程，不用于替代密码哈希。敏感配置只从服务端环境读取。

### 5.3 Markdown 编辑器

采用 Milkdown 7 的 Crepe 编辑器、GFM preset 与 Vue 3 集成；源码模式使用独立的纯文本/CodeMirror 编辑面板。编辑器仅在客户端挂载（Nuxt `<ClientOnly>` 或 `onMounted`）。

选择依据：

- Milkdown 以 Markdown 为输入输出，基于 Remark 与 ProseMirror，适合 Markdown 作为主格式。
- Crepe 已覆盖标题、强调、删除线、引用、列表、任务列表、链接、图片、表格和代码块等所需交互。
- `getMarkdown` 与 `replaceAll` 可用于可视化模式和源码模式的显式同步。

无损约束：

1. Frontmatter 永远由独立表单维护，不进入可视化正文编辑器。
2. 从源码切换到可视化前，必须在内存中做“解析 → 序列化 → 等价性”检查。
3. 对 `<NuxtLink>`、MDC、自定义 HTML、Jekyll 标签或未知语法无法无损处理时，禁止进入会丢数据的可视化模式，并明确提示使用源码模式。
4. 切换模式不能触发保存；保存始终使用当前明确确认的 Markdown 字符串。
5. 阶段 3 必须增加覆盖全部需求元素及现有扩展语法的往返测试。

### 5.4 S3 兼容对象存储

采用 `@aws-sdk/client-s3` v3，通过 `endpoint`、`region`、`bucket` 与 `forcePathStyle` 环境变量适配 AWS S3、腾讯云 COS 等兼容实现。图片在 Nitro 服务端用 Sharp 校验、限制尺寸并转为 WebP 后上传。

约束：

- 浏览器永远拿不到 Access Key 和 Secret Key。
- 上传 API 不信任扩展名，校验实际 MIME/图片解码结果、大小和尺寸。
- 对象 key 由系统生成，不拼接用户文件名；公开 URL 与 API endpoint 分开配置。
- 数据库记录对象 key、公开 URL、上传者、草稿和时间，但不保存图片二进制。

### 5.5 Git 发布

生产环境使用两个完全分离的目录：

- 部署目录：GitHub Actions 管理，只用于构建/运行，不允许 CMS 写入。
- `CMS_GIT_WORKTREE`：持久卷或宿主机目录中的独立 clone，只允许发布服务操作。

发布事务边界：

1. 锁定对应草稿并再次检查状态、权限和基线提交。
2. 在独立工作区 fetch，并要求目标分支与远端同步。
3. 校验 Frontmatter、Markdown、目标路径和内容范围。
4. 临时文件写入后原子替换。
5. 仅暂存目标文章及必要的受控成员文件。
6. commit 后 push。
7. 只有 push 成功才在 PostgreSQL 标记 `published` 并记录 commit hash。
8. push 失败时保留草稿和失败日志；工作区恢复到可重试状态，但不得重写远端历史。

GitHub 是代码和正式 Markdown 的唯一权威来源。恢复旧版本通过新 commit 完成，禁止 force push。

## 6. 数据模型草案

表名采用复数 snake_case。字段会在对应阶段通过 migration 最终确定。

### 6.1 阶段 1 基础实体

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `roles` | `id`, `code`, `name` | 初始化 `admin`、`member`，`code` 唯一 |
| `users` | `id`, `email`, `display_name`, `password_hash`, `status`, timestamps | 登录主体；邮箱规范化后唯一 |
| `user_roles` | `user_id`, `role_id` | 多对多，权限只从服务端读取 |
| `sessions` | `id`, `user_id`, `token_hash`, `expires_at`, `last_seen_at`, `revoked_at`, `ip_hash`, `user_agent` | 可撤销会话；`token_hash` 唯一 |
| `members` | `id`, `member_key`, `name`, `avatar_url`, `source_path`, timestamps | `member_key` 是文章引用的稳定 ID；可选关联用户 |
| `user_members` | `user_id`, `member_id` | 一个用户至多绑定一个成员，成员也至多绑定一个用户 |
| `audit_logs` | `id`, `actor_user_id`, `action`, `target_type`, `target_id`, `metadata`, `created_at` | 只追加，不允许业务层更新或删除 |

用户禁用使用状态字段，不级联删除审计记录。审计 metadata 使用 JSONB，但常用检索字段必须单独成列。

### 6.2 后续阶段实体

| 阶段 | 表 | 用途 |
| --- | --- | --- |
| 2 | `articles` | UUID 稳定标识、collection、规范化相对路径、当前 Git blob/commit、软删除状态 |
| 3 | `drafts`、`draft_authors` | 正文、可编辑 Frontmatter、状态、基线版本、创建者、自动保存版本号 |
| 4 | `review_events`、`edit_locks` | 审核状态流转、驳回原因、心跳、接管审计 |
| 5 | `publish_records` | 操作者、审核者、commit hash、路径、操作类型、失败原因 |
| 6 | `media_assets` | 对象 key、URL、上传者、关联草稿、图片元数据 |
| 7 | `article_deletion_events` | 软删除、恢复及其审计关联 |

文章 ID 使用数据库 UUID，与可变标题和路径分离。初次扫描按规范化相对路径建档；CMS 内发生路径变化时更新同一行，从而保留稳定 ID。所有文件读取都先 `realpath`，再验证结果仍位于允许的 collection 根目录内。

## 7. Frontmatter 策略

CMS 统一字段为：

```yaml
title:
authors: []
contributors: []
updatedAt:
publishedAt:
description:
```

但迁移不能删除现有集合专用字段（例如新闻的 `date`、`tags`、`image`、`bvid`，成员的 `role` 等）。

- 阶段 2 只解析并原样展示，不修改内容。
- 阶段 3 的普通用户只编辑 `title`、`description`、`authors`。
- `contributors`、`updatedAt`、`publishedAt` 由发布服务生成，客户端提交的同名值被忽略。
- 未识别 Frontmatter 字段以保留映射保存，禁止因为表单未展示就删除。
- `authors` 与 `contributors` 只保存 `members.member_key`。
- `description` 为空时，发布服务从去除 Markdown 标记后的首段生成并限制长度。

## 8. API 路由草案

全部业务 API 置于 `/api/cms`。写操作采用 JSON 或受控 multipart，统一返回结构化错误码。

### 阶段 1

- `POST /api/cms/auth/login`
- `POST /api/cms/auth/logout`
- `GET /api/cms/auth/session`
- `GET /api/cms/profile`
- `PATCH /api/cms/profile`
- `GET /api/cms/admin/users`
- `POST /api/cms/admin/users`
- `PATCH /api/cms/admin/users/:id`

### 阶段 2

- `GET|POST /api/cms/members`
- `GET|PATCH /api/cms/members/:id`
- `GET /api/cms/articles`
- `GET /api/cms/articles/:id`

### 阶段 3

- `POST /api/cms/drafts`
- `GET|PUT /api/cms/drafts/:id`
- `GET /api/cms/articles/:id/draft`

### 阶段 4

- `POST /api/cms/drafts/:id/submit`
- `POST /api/cms/drafts/:id/withdraw`
- `POST /api/cms/reviews/:id/approve`
- `POST /api/cms/reviews/:id/reject`
- `POST /api/cms/articles/:id/lock`
- `PUT|DELETE /api/cms/articles/:id/lock`
- `POST /api/cms/articles/:id/lock/takeover`

### 阶段 5 以后

- `POST /api/cms/drafts/:id/publish`
- `GET /api/cms/articles/:id/history`
- `GET /api/cms/articles/:id/history/:commit`
- `GET /api/cms/articles/:id/diff`
- `POST /api/cms/articles/:id/restore`
- `POST /api/cms/media`
- `POST /api/cms/articles/:id/delete`
- `POST /api/cms/articles/:id/restore-deleted`

动态参数永远通过数据库 ID 查找；客户端不能提交任意绝对路径。

## 9. 后台页面草案

| 页面 | 路由 | 最低权限 |
| --- | --- | --- |
| 登录 | `/cms/login` | 公开（已登录则跳转） |
| 后台首页 | `/cms` | member |
| 文章列表 | `/cms/articles` | member |
| 文章只读详情 | `/cms/articles/:id` | member |
| 新建/编辑 | `/cms/articles/new`、`/cms/articles/:id/edit` | member |
| 待审核列表与详情 | `/cms/reviews`、`/cms/reviews/:id` | admin |
| 成员管理 | `/cms/members` | admin 写；member 只读 |
| 用户管理 | `/cms/users` | admin |
| 个人中心 | `/cms/profile` | member |

阶段 1 需把现有 `app/app.vue` 的前台壳迁入 `default` layout，并给 CMS 使用独立 layout；迁移不得改变现有前台页面结构和样式。

## 10. 权限模型

| 能力 | 未登录 | member | admin |
| --- | --- | --- | --- |
| 浏览前台正式内容 | 是 | 是 | 是 |
| 访问 CMS | 否 | 是 | 是 |
| 保存草稿/提交/审核前撤回 | 否 | 是 | 是 |
| 直接正式发布 | 否 | 否 | 仅审核通过内容 |
| 审核、驳回 | 否 | 否 | 是 |
| 强制接管编辑锁 | 否 | 否 | 是，必须审计 |
| 管理成员和用户 | 否 | 否 | 是 |
| 删除/恢复正式文章 | 否 | 否 | 是，必须审计 |

管理员不是权限检查的客户端开关。每个 API 服务函数都必须显式声明最低角色和资源级条件。

## 11. 数据流

### 11.1 草稿

```text
正式 Markdown + 当前 Git 版本
  → 创建/恢复 PostgreSQL 草稿
  → 自动保存（乐观版本号）
  → 提交审核
  → 管理员批准
```

草稿保存从不写 `content/`，也不产生 Git commit。

### 11.2 发布

```text
approved 草稿
  → 再次校验基线版本
  → 独立工作区生成 Markdown
  → 原子写入、commit、push
  → 写 publish_records
  → 标记 published
  → GitHub Actions 部署
  → 前台读取新的正式 Markdown
```

### 11.3 图片

```text
浏览器上传
  → Nitro 鉴权和限流
  → 解码/校验/压缩/WebP
  → S3 PutObject
  → media_assets 记录
  → 返回公开 URL 并插入草稿
```

## 12. 部署、备份与迁移

- 最终由 Docker Compose 运行 Nuxt 和 PostgreSQL。
- PostgreSQL 数据、CMS Git 工作区和必要日志使用持久卷；镜像本身不保存状态。
- 正式 Markdown 以 GitHub 为准，图片以 S3 为准。
- 数据库使用 `pg_dump`/`pg_restore`；恢复演练属于阶段 8 和阶段 9。
- GitHub Actions 是部署目录的唯一修改者。部署失败要保留旧容器或可回切镜像。
- `.env` 和 SSH/S3/数据库密钥不进入 Git；仓库只保存 `.env.example`。

## 13. 不允许轻易修改的核心设计

1. 正式正文只以 Git 中 Markdown 为准。
2. 未发布草稿只保存在 PostgreSQL，不写正式内容目录。
3. CMS Git 工作区与运行/部署目录物理分离。
4. Git push 成功之前不得对用户宣称发布成功。
5. 恢复历史通过新 commit 完成，不删除历史、不 force push。
6. 所有权限在服务端校验，普通成员不能绕过审核。
7. 稳定成员 ID 和文章 UUID 不由可变姓名、标题或展示 URL决定。
8. 未识别 Markdown/Frontmatter 必须无损保留，不能静默规范化或删除。
9. 密钥只存在于环境变量、Docker secrets 或 GitHub Secrets。
10. 各阶段只实现需求文档指定范围，并在验收后才进入下一阶段。

## 14. 选型核验来源

- Nuxt 4 server 目录与 API 约定：<https://nuxt.com/docs/4.x/directory-structure/server>
- Nuxt 4 route middleware：<https://nuxt.com/docs/4.x/directory-structure/app/middleware>
- Nuxt 4 TypeScript 项目引用：<https://nuxt.com/docs/4.x/directory-structure/tsconfig>
- Drizzle PostgreSQL 驱动：<https://orm.drizzle.team/docs/get-started-postgresql>
- Milkdown Vue 集成：<https://milkdown.dev/docs/recipes/vue>
- Milkdown Crepe：<https://milkdown.dev/docs/guide/using-crepe>
- Milkdown Markdown 宏：<https://milkdown.dev/docs/guide/macros>
- AWS SDK v3 S3 client：<https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/>
- 腾讯云 COS 的 S3 兼容说明：<https://intl.cloud.tencent.com/zh/document/product/436/34688>
- OWASP 密码存储建议：<https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html>
