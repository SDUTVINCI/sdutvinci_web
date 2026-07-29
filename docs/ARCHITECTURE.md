# Vinci 网站与 CMS 架构

## 1. 文档状态

本文记录网站与 CMS 的长期架构约束。阶段 0 于 2026-07-25 完成首次技术方案确认，阶段 1 于同日落地数据库与身份认证基础，阶段 2 落地成员管理和文章只读索引。后续只有在发生重大架构调整时才修改本文，并应同步在 `docs/CODEX_HANDOVER.md` 追加说明。

当前已接入 PostgreSQL、登录、权限骨架、成员管理、文章浏览、Milkdown 编辑器、数据库草稿、审核流程、编辑锁、正式版本冲突检查、隔离 Git 发布、历史恢复、服务端 WebP 图片处理和 S3 兼容对象存储，以及 Docker Compose、备份恢复、GitHub Actions 镜像发布和内网服务器主动拉取自动部署。

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
- 每份成员文件均有稳定 `id`，前台成员路由按该 ID 查找；中文文件名和姓名不再承担身份标识职责。
- 当前文章 Frontmatter 并不统一：
  - Wiki 主要只有 `title`；
  - 新闻使用 `title`、`date`、`author`、`tags`、`image`、`bvid`、`summary`；
  - 成员使用 `name`、`image`、`role`、`type`、`time`、`advisor`、`grade`、`affiliation`、`links`。
- 内容中存在 Markdown 之外的扩展语法，包括 `<NuxtLink>`、MDC/Vue 组件、原始 HTML
  和代码示例中的模板标记。阶段 3 确认实际内容里的三处
  `{% include section.html %}` 没有对应模板且不会被 Nuxt Content 执行，已按维护者
  授权精确删除；其他未知语法仍必须可见，不得被编辑器或渲染器静默丢弃。

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
                         └─ GitHub Actions 验证并发布 SHA 镜像
                              └─ 服务器 systemd timer 主动拉取并部署
```

系统边界：

- Nuxt 前台、CMS 页面和 Nitro API 保持在同一个项目、同一个应用镜像中。
- 正式文章正文的唯一数据源是 GitHub 中的 Markdown。
- PostgreSQL 保存业务状态和辅助索引，不成为正式文章正文的线上数据源。
- 图片正文存放在 S3 兼容对象存储，PostgreSQL 只记录元数据。
- 运行中的部署目录只读；CMS 只在独立 Git 工作区写 Markdown。

### 3.1 Docker、部署与备份边界

- `runtime` 镜像只包含 Nitro 输出、构建时的正式 Markdown 和运行 Git 发布所需工具，应用进程以非 root 用户运行；`operations` 镜像提供 migration 和首个管理员初始化。
- Compose 使用 `postgres_data`、`cms_git_worktree` 和 `gateway_config` 三个持久 volume。镜像内 Markdown 不再与宿主机 Markdown 同时作为前台数据源。
- PostgreSQL 仅连接 internal network；`app-blue`/`app-green` 不映射宿主机端口，常驻 Caddy gateway 绑定回环地址，再由宿主机 HTTPS reverse proxy 对外服务。
- Nuxt Content 的索引和预渲染输出在构建期产生，因此 `content/**` 变化也构建带完整 commit SHA 的 runtime 镜像，而不是运行时覆盖 Markdown。
- Actions 对 PR 做验证，对每个 `main` push 发布同 SHA 的 runtime/operations 镜像。服务器 timer 从当前线上 commit 到 `origin/main` 重新分类累计变化：纯 `content/**` 跳过 operations 和 migration，其他变化执行完整应用部署。
- 服务器只使用出站 HTTPS 读取 GitHub/GHCR，不要求 Actions 通过公网 SSH 登录。镜像未齐时保持当前版本；候选失败记录 SHA 并停止周期性重试。
- 新 runtime 总是在非活动槽位通过健康检查后由 gateway graceful reload 切换；旧槽位保留到下一次发布，切换或网关健康失败时可以立即恢复。
- migration 不自动 down，生产 schema 变更必须对旧、新应用保持向后兼容。
- PostgreSQL 用 custom-format `pg_dump` 备份；CMS Git 工作区备份 refs bundle、tracked patch 和 untracked archive，仅用于异常审查。
- 正式 Markdown 由 GitHub 保护，图片由 S3 保护；`.env` 与私钥另存加密 secret store。
- 数据库恢复只允许 checksum 正确的备份和完全空的目标库，并要求绑定 Compose project 与数据库名的确认令牌。

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
- 阶段 9 已落地共享 PostgreSQL 限流：单账号失败、单来源登录尝试和单用户图片上传分别限流，429 带 `Retry-After`；限流键只保存 HMAC，不保存原始账号或 IP。
- 不存在、停用和密码错误账号都执行 Argon2id 校验并返回相同错误，降低账号枚举信号。

`users.account` 是唯一、稳定的登录 ID，使用小写字母和数字（例如 `dongjiahui`、`dongjiahui1`）。认证用户不重复保存姓名、头像或邮箱；阶段 2 通过相同 ID 与 `members.member_key` 一对一绑定，并从成员实体读取所有展示资料。

`CMS_AUTH_SECRET` 用于 CSRF/一次性安全流程，不用于替代密码哈希。敏感配置只从服务端环境读取。

### 5.3 Markdown 编辑器

采用 Milkdown 7 的 Crepe 编辑器、GFM preset 与 Vue 3 集成；源码模式使用独立的纯文本/CodeMirror 编辑面板。编辑器仅在客户端挂载（Nuxt `<ClientOnly>` 或 `onMounted`）。

选择依据：

- Milkdown 以 Markdown 为输入输出，基于 Remark 与 ProseMirror，适合 Markdown 作为主格式。
- Crepe 已覆盖标题、强调、删除线、引用、列表、任务列表、链接、图片、表格和代码块等所需交互。
- `getMarkdown` 与 `replaceAll` 可用于可视化模式和源码模式的显式同步。

无损约束：

1. Frontmatter 永远由独立表单维护，不进入可视化正文编辑器。
2. 从源码切换到可视化前，用 Remark 识别真正的 HTML/Vue 语法；不得把代码块、行内代码或 `<https://...>` 自动链接误判为组件。
3. 所有文章均可进入混合可视化模式；`<NuxtLink>`、MDC、自定义 HTML、Jekyll 标签等扩展语法转换为不可编辑、不可删除的 ProseMirror 原子节点，显示语法类型并在序列化时还原原始源码。
4. 切换模式不能触发保存；保存始终使用当前明确确认的 Markdown 字符串。
5. 测试必须覆盖普通区域编辑、保护节点删除拦截、扩展语法无损往返，以及代码/自动链接不被误判。

HTML 安全策略：

- 维护者明确要求兼容高级原始 HTML、Vue/MDC 和既有扩展语法，因此渲染层有意不启用 HTML sanitizer。
- 这是已接受的存储型 XSS 风险，依赖可信 CMS 账号、管理员审核/发布和 Git 可审计历史控制；这些控制不能消除恶意 HTML 的浏览器执行能力。
- 若作者信任模型改变，必须单独设计 allowlist 或 sandbox，并先评估既有 260 个内容文件的兼容迁移，不能在普通安全补丁中静默改变渲染结果。

### 5.4 S3 兼容对象存储

采用 `@aws-sdk/client-s3` v3，通过 `endpoint`、`region`、`bucket` 与 `forcePathStyle` 环境变量适配 AWS S3、腾讯云 COS 等兼容实现。图片在 Nitro 服务端用 Sharp 校验、限制尺寸并转为 WebP 后上传。

约束：

- 浏览器永远拿不到 Access Key 和 Secret Key。
- 上传 API 不信任扩展名，校验 Sharp 实际解码结果、大小和尺寸。浏览器声明只用于限制可接受的主流图片类别；当 JPEG/JPG、PNG、WebP、GIF 之间的扩展名或声明 MIME 标错时，以安全解码出的真实格式为准。
- 对象 key 由系统生成，不拼接用户文件名；公开 URL 与 API endpoint 分开配置。
- 数据库记录对象 key、公开 URL、上传者、草稿和时间，但不保存图片二进制。
- 阶段 6 已实现 JPEG/JPG、PNG、WebP、GIF 输入，统一输出 WebP；动态 GIF 会保留动画帧、播放延迟和循环设置。最大字节数、宽高和质量均可由服务端环境变量调整。
- 上传必须关联处于 `draft` 状态的草稿，并同时通过资源权限和有效编辑租约校验。对象上传后若租约失效或数据库记录失败，服务会尽力删除刚上传的对象。
- `S3_PUBLIC_BASE_URL` 指向可公开读取的 Bucket 域名或 CDN/路径前缀；业务代码只拼接系统生成的对象 key，不依赖特定厂商 URL 规则。

### 5.5 Git 发布

生产环境使用两个完全分离的目录：

- 部署目录：服务器自动部署 service 管理，只用于运行和运维，不允许 CMS 写入。
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

### 6.1 阶段 1～2 已落地实体

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `roles` | `id`, `code`, `name` | 初始化 `admin`、`member`，`code` 唯一 |
| `users` | `id`, `account`, `password_hash`, `status`, timestamps | 只保存认证信息；`account` 是唯一稳定登录 ID |
| `user_roles` | `user_id`, `role_id` | 多对多，权限只从服务端读取 |
| `sessions` | `id`, `user_id`, `token_hash`, `expires_at`, `last_seen_at`, `revoked_at`, `ip_hash`, `user_agent` | 可撤销会话；`token_hash` 唯一 |
| `rate_limit_buckets` | `scope`, `key_hash`, `window_started_at`, `attempt_count`, `blocked_until`, `updated_at` | 阶段 9 共享限流；`scope + key_hash` 主键，键为 HMAC |
| `members` | `id`, `member_key`, `name`, `avatar_url`, `source_path`, `metadata`, timestamps | `member_key` 是文章引用的稳定 ID；可选关联同 ID 用户 |
| `user_members` | `user_id`, `member_id` | 一个用户至多绑定一个成员，成员也至多绑定一个用户 |
| `audit_logs` | `id`, `actor_user_id`, `action`, `target_type`, `target_id`, `metadata`, `created_at` | 只追加，不允许业务层更新或删除 |
| `articles` | `id`, `collection`, `relative_path`, `public_path`, `directory`, `title`, `frontmatter`, `search_text`, `content_hash`, `is_present`, timestamps | 阶段 2 只读索引；正文仍以 Markdown 为唯一来源 |

用户禁用使用状态字段，不级联删除审计记录。审计 metadata 使用 JSONB，但常用检索字段必须单独成列。

### 6.2 阶段 3～6 已落地及后续实体

| 阶段 | 表 | 用途 |
| --- | --- | --- |
| 3 | `drafts`、`draft_authors` | 正文、保留 Frontmatter、基线内容哈希、创建者、作者关系和乐观保存版本号；阶段 3 状态仅为 `draft` |
| 4 | `review_events`、`edit_locks` | 只追加的审核状态流转与驳回原因；按文章或新草稿目标建立带租约 ID、心跳与过期时间的独占编辑锁 |
| 5 | `publish_records` | 发布/恢复尝试的操作者、审核者、commit hash、路径、状态、时间和失败原因 |
| 6 | `media_assets` | 已落地：对象 key、URL、上传者、关联草稿、原始格式/大小及 WebP 宽高/大小 |
| 7 | `article_deletion_events` | 正式文章 Git 删除/恢复 Commit、来源版本及审计关联；`articles.deleted_at` 保存可恢复软删除状态 |

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
- `GET /api/cms/admin/users`
- `POST /api/cms/admin/users`
- `PATCH /api/cms/admin/users/:id`

### 阶段 2

- `GET|POST /api/cms/members`
- `GET|PATCH /api/cms/members/:id`
- `GET /api/cms/articles`
- `GET /api/cms/articles/:id`

### 阶段 3

- `GET /api/cms/drafts`
- `POST /api/cms/drafts`
- `GET|PUT /api/cms/drafts/:id`
- `GET /api/cms/articles/:id/draft`

### 阶段 4

- `POST /api/cms/drafts/:id/submit`
- `POST /api/cms/drafts/:id/withdraw`
- `POST /api/cms/drafts/:id/reopen`
- `POST /api/cms/drafts/:id/resync`
- `GET /api/cms/drafts/:id/comparison`
- `GET /api/cms/drafts/:id/review-events`
- `GET|POST|PUT|DELETE /api/cms/drafts/:id/lock`
- `POST /api/cms/drafts/:id/lock/takeover`
- `GET /api/cms/reviews`
- `GET /api/cms/reviews/:id`
- `POST /api/cms/reviews/:id/approve`
- `POST /api/cms/reviews/:id/reject`

锁接口以草稿 ID 作为安全入口，服务端再解析实际锁目标：已有文章统一锁定 `articleId`，因此不同用户的草稿不能同时编辑同一篇正式文章；尚无 `articleId` 的新文章锁定自身 `draftId`。客户端不能自行指定锁目标。

### 阶段 5 已落地

- `POST /api/cms/drafts/:id/publish`
- `GET /api/cms/articles/:id/history`
- `GET /api/cms/articles/:id/versions/:commit`
- `GET /api/cms/articles/:id/diff`
- `POST /api/cms/articles/:id/versions/:commit/restore`

### 阶段 6 已落地

- `POST /api/cms/media`

### 阶段 7 已落地

- `GET /api/cms/dashboard`
- `GET /api/cms/articles/resolve?publicPath=...`
- `POST /api/cms/articles/:id/delete`（仅管理员；独立 Git 工作区删除并 Push）
- `POST /api/cms/articles/:id/restore-deleted`（仅管理员；从删除前 Commit 恢复并生成新 Commit）
- `DELETE /api/cms/drafts/:id`、`POST /api/cms/drafts/:id/delete`（本人或管理员软删除）
- `POST /api/cms/drafts/:id/restore`（本人或管理员恢复）

正式文章删除不会改写或删除历史 Commit：删除成功后将文章文件从当前分支移除并记录 `article_deletion_events`；恢复读取删除前来源 Commit，写入新文件并创建新的 restore Commit。草稿删除只更新 PostgreSQL 的 `deleted_at`，恢复不会写 Markdown。

### 阶段 8 以后

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
| 账号安全与用户管理 | `/cms/users` | member 修改本人密码；admin 管理全部账号 |
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
| 修改本人密码 | 否 | 是，仅本人且验证当前密码 | 是，仅本人且验证当前密码 |
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

阶段 4 状态机为：

```text
draft → pending_review
pending_review → withdrawn → draft
pending_review → rejected → draft
pending_review → approved
approved → published（仅阶段 5）
```

`pending_review` 与 `approved` 不可编辑。重新编辑驳回或撤回内容必须显式恢复为 `draft`。提交和审核通过都会读取正式 Markdown 计算实时 SHA-256；不能只信任文章索引中的缓存哈希。发现冲突后保持原状态和内容不变，用户在差异视图中手动整理，再明确确认新正式版本为草稿基线；系统不自动合并。

### 11.2 发布

```text
approved 草稿
  → 再次校验基线版本
  → 独立工作区生成 Markdown
  → 原子写入、commit、push
  → 写 publish_records
  → 标记 published
  → GitHub Actions 发布镜像
  → 服务器 timer 主动部署
  → 前台读取新的正式 Markdown
```

阶段 4 的“审核通过”只把草稿标为 `approved`，不会写 Markdown、执行 Git 或进入 `published`。阶段 5 在真正写入前必须再次读取正式 Markdown 校验基线，不能复用较早的审核结果代替发布前检查。

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
- 服务器自动部署 service 是部署目录的唯一自动修改者。宿主机管理员通过 `install-auto-deploy.sh` 安装、试跑和启用 systemd timer；只有试跑成功才启用周期检查。部署失败要保留旧容器或可回切镜像，并停止重复尝试同一失败 SHA。
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
9. 密钥只存在于服务器环境变量、受控密钥文件、Docker secrets 或确有需要的 GitHub Secrets。
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

## 15. V2.0 已确认目标约束（尚未实现）

> 本节在 V2 阶段 0 只冻结目标约束，不改变以上 V1 现状。详细设计和只读基线见
> `docs/v2/PHASE_V2_0_DESIGN.md`；实现必须按 V2 各阶段验收后逐步落地。

1. V2 最终由 PostgreSQL 正式 Revision 作为线上内容唯一权威来源；阶段 5 切换前继续保持 V1 Git-first。
2. `news`、`wiki`、`members` 必须能分别采用 `legacy_git`、`database_shadow`、`database`，不能一次性无回滚地切换。
3. DB-first 发布时，正式 Revision、当前版本指针、审计和导出 Outbox 在一个数据库事务中提交；GitHub 故障不得阻塞已切换集合的线上发布。
4. 已存在的 `SDUTVINCI/sdutvinci_content` 是数据库的异步可审计输出及 PR 提案入口，不是应用启动时覆盖数据库的输入。不得重新创建、清空、覆盖、批量删除或 Force Push。
5. V2 最终取消宿主机 `vinci-deploy` 专用用户，默认使用执行安装的当前系统用户；用户名、UID/GID、Home、目录和凭据位置均由本机安全解析或显式配置，不写死进仓库。
6. 数据库备份、配置备份、内容快照、报告、日志、迁移包、临时目录、镜像和缓存都必须有自动清理和有限保留策略。
7. 任何清理都必须保护最新成功备份、最近验证可恢复备份、锁定备份、当前活动镜像和至少一个已验证回滚镜像；保护集合耗尽空间时停止并告警，不强制删除。
8. Nuxt Content、代码仓库 `content/`、内容预渲染和内容镜像分类只允许在阶段 10、且数据库与独立内容仓库均已验证完整后移除。

## 16. V2 阶段 1 已落地：正式 Revision 模型与安全回填

阶段 1 只完成 expand，不改变本文件前述 V1 正式行为。Git 中 Markdown、Git 历史、
恢复 API、Nuxt Content 和前台读取仍是当前生产路径；Revision 在阶段 2 影子写入和
阶段 5 权威切换前不是发布权威。

新增 `article_revisions` 保存不可变的完整 Markdown 原文、解析正文、完整
Frontmatter、SHA-256、文章内版本号和来源关联。`articles.current_revision_id` 与
`drafts.base_revision_id` 均为可空外键；旧 `articles.content_hash`、
`articles.frontmatter` 和 `drafts.base_content_hash` 继续保留，旧应用可忽略新表和
新列。业务服务没有 Revision 正文 UPDATE/DELETE 路径，后续发布、恢复和成员发布只能
追加新版本。

首次回填以 V1 索引的 `(collection, relative_path)` 定位文章并直接复用
`articles.id` 作为稳定 UUID 和未来 `vinciId`。工具默认 Dry Run；实际写入要求显式
`--apply --confirm=BACKFILL_ARTICLE_REVISIONS`，并在一个 PostgreSQL 事务内取得 advisory
lock、锁定文章行、二次读取文件、校验完整原文 SHA-256、插入首版 Revision 和设置当前
指针。任一活跃文章缺文件、哈希漂移、未索引文件、损坏指针或既有 Revision 冲突都会
阻止全部写入。已删除或 V1 标记为不存在的文章明确跳过，不从 Git 历史猜测正文。

阶段 1 仅覆盖 `news` 和 `wiki`；`members` 的 Revision 化属于阶段 9。回填不改
Markdown、不连接或写入独立内容仓库、不修改 V1 发布时间，也不自动运行 Migration。
详细命令、验证、失败处理和回滚见
`docs/v2/PHASE_V2_1_ACCEPTANCE.md`。

## 17. V2 阶段 2 已落地：Git-first Revision 影子链路

阶段 2 保持 Git Push 为正式发布和恢复的前置条件。只有测试环境显式设置
`CONTENT_PUBLISH_MODE=revision_shadow` 时，Push 成功后的同一个数据库事务才追加
Revision，并同时更新文章当前指针、草稿基线指针、V1 publish record 和审计。Push
失败不创建 Revision。默认 `legacy_git` 完全保持 V1 行为；`database` 在阶段 5 前
fail closed。

Revision 新增可空 `source_operation_id` 和 `git_commit_hash`。前者以 V1
`publish_records.id` 作为业务幂等键，后者把影子 Revision 与 Git Commit 关联；唯一
约束阻止同一操作或同一文章 Commit 重复写入。阶段 1 backfill 行保持可空，避免改写
既有数据。

数据库历史列表、详情、正文 Diff 和从 Revision 恢复均已有影子服务及测试 API，但只在
`NODE_ENV=test` 与 `revision_shadow` 同时满足时开放。读取仍要求登录；恢复继续要求
管理员、同源和 CSRF。V1 Git 历史、版本、Diff 和恢复入口没有移除，前台与 Nuxt
Content 也没有切换。

影子模式下，发布后的 CMS 列表和仪表盘不会在每次请求时用应用构建目录中的静态
`content/` 重新同步文章投影；文章详情优先读取独立 `CMS_GIT_WORKTREE`，仅当该路径
尚未存在时回退到静态内容根。显式的 `cms:content:sync` 仍可用于首次建库或受控修复。
这是测试影子链路的读取一致性边界，不改变 `legacy_git` 的请求同步行为，也不把生产
前台从 Nuxt Content 切换到数据库。

只读对账工具核对发布时间、文章作者、发布/审核身份、来源草稿、正文、完整原文和
SHA-256，并报告没有对应 Revision 的 Git Commit；它没有自动修复模式。V2 前的完整
Git 历史未在阶段 1 回填，真实长历史文章出现旧提交未匹配是已知差异。详细命令、失败
处理、回滚与人工验收见 `docs/v2/PHASE_V2_2_ACCEPTANCE.md`。

## 18. V2 阶段 3 已落地：Comark 候选渲染与 CodeMirror

阶段 3 没有切换生产前台。新闻、Wiki 和成员的正式页面仍由 Nuxt Content 读取代码
仓库 `content/`；Comark 只用于 CMS 草稿的“最终效果预览”和后续阶段共用的候选组件。
内容权威、Git-first 发布事务、Revision 影子链路和部署行为均未改变。

草稿页现在有可视化、源码和最终预览三种模式。源码模式使用 CodeMirror 6，并在客户
端初始化失败时回退到 `textarea`。模式切换只改变显示层，不在每次按键做
Milkdown/CodeMirror 双向重建，也不会因切换自动保存。图片上传继续复用既有安全上传
服务，并按当前模式插入或无损追加 Markdown。

`VinciMarkdownRenderer` 和 `shared/utils/vinci-markdown.ts` 构成候选渲染管线：
兼容 `<NuxtLink>`、MDC/Vue 组件、原始 HTML、任务列表、表格、Shiki 代码高亮、
GitHub 风格标题 ID 和目录；未知 Liquid/Jinja 模板标记在非代码文本中被安全编码为
可见文本。安全层阻断可执行标签、事件属性和危险 URL，同时保留现有内容需要的 HTTPS
iframe。

批量工具同时解析全部 260 篇现有 Markdown，并保存每篇源码 SHA、旧/新 AST 摘要和
差异。当前 260 篇均成功解析、无渲染失败；227 篇比较无差异，33 篇有 35 项已记录的
换行、链接、空标题或代码块计数差异。这些差异不会触发自动正文改写，是阶段 4 影子
HTTP/DOM 比较和生产切换前的显式审查输入。详细报告、安全边界、回滚和联合人工验收见
`docs/v2/PHASE_V2_3_ACCEPTANCE.md`。

## 19. V2 阶段 4 已落地：数据库读取与 Comark 前台候选

阶段 4 增加了统一的正式内容查询服务，但没有改变生产权威或发布事务。未配置新变量
时，新闻、Wiki 和成员仍由 Nuxt Content 读取代码仓库 `content/`；
`CONTENT_CANDIDATE_ENV=disabled` 会拒绝数据库候选。只有显式的 `test` 或
`staging` 候选环境，才能把单个集合设为 `database_shadow` 或 `database`。

```text
                    ┌─ legacy_git ─────── Nuxt Content ── 旧响应
页面统一 composable ├─ database_shadow ── 旧查询 + DB 旁路 ── 旧响应
                    └─ database ───────── current Revision ── Comark SSR
```

数据库服务对新闻和 Wiki 使用 `articles.current_revision_id` 连接当前
`article_revisions`，并排除删除或不再存在的文章；Wiki 导航继续使用冻结的路径元数据
计算文档根、章节顺序、上一页和下一页。成员只建立结构化数据库候选，正文仍只读
legacy `source_path`，成员权威没有切换。数据库搜索、Sitemap 和 RSS 同样只在显式
候选环境开放。

详情候选缓存使用包含 Revision UUID 的
`phase4:<collection>:<articleId>:revision:<revisionId>` 键，并提供管理员、同源和
CSRF 保护的精确失效接口。缓存有 TTL 和容量上限；本阶段没有把失效接口接入
Git-first 发布事务。候选页面和 CMS “最终效果预览”共用
`VinciMarkdownRenderer` 与 `shared/utils/vinci-markdown.ts`，因此使用相同的
Comark、安全过滤、标题 ID 和代码高亮管线。

完整影子报告覆盖 270 条路由：267 组双方为 200，3 组缺失路径双方为 404，没有状态、
关键标题或 SEO 缺失级别的不匹配。阶段 3 的 33 篇/35 项差异全部原样映射；另有 25 条
非阻断 DOM/SEO 内容差异明确保留，未通过批量改写 Markdown 消除。实现边界、报告、
安全的隔离验收脚本和回滚方式见 `docs/v2/PHASE_V2_4_ACCEPTANCE.md`。
