# Codex 开发交接

本文件只允许追加阶段记录，不得删除或覆盖历史。

## 2026-07-25：阶段 0——项目审查与技术方案确认

### 完成状态

- 阶段 0 已完成，等待人工验收。
- 尚未开始阶段 1。

### 审查结果

- 当前栈：Nuxt 4.4.x、Vue 3.5.x、Nuxt Content 3.13.x、npm lockfile v3、Nitro node-server。
- 内容数量：成员 32、新闻 2、Wiki 226。
- 当前没有 CMS、`server/` API、PostgreSQL、migration、鉴权、Docker 或 GitHub Actions。
- 当前根组件直接包含前台 Header/Footer，阶段 1 创建 CMS layout 时需要小心迁移成 default layout。
- 当前内容存在 `<NuxtLink>` 与 `{% include ... %}` 等扩展语法，阶段 3 必须做无损往返保护。
- 当前生产构建依赖 `nuxt-studio` 的仓库检测；普通 `npm run build` 在非 CI 环境会因缺少仓库 owner/repo 失败。

### 修改文件

- `.env.example`
- `tsconfig.json`
- `package.json`
- `package-lock.json`
- `nuxt.config.ts`
- `app/pages/wiki/[...slug].vue`
- `utils/wiki-content-meta.ts`
- `docs/ARCHITECTURE.md`
- `docs/CODEX_HANDOVER.md`

### 数据库变更

- 无。
- 已在 `docs/ARCHITECTURE.md` 记录阶段 1 基础表和后续表草案。

### API 变更

- 无。
- 已记录 `/api/cms/*` 路由草案。

### 新增依赖

- 开发依赖：`typescript`、`vue-tsc`、`@types/node`，用于执行 Nuxt 官方类型检查。TypeScript 固定在 5.9.3，避免当前 Vue 类型检查器尚不兼容 TypeScript 7。
- 后续计划：Drizzle ORM + `pg`、Argon2、Milkdown/Crepe、AWS SDK v3 S3 client、Sharp。只能在对应阶段安装。

### 新增环境变量

- 已在 `.env.example` 分类列出应用、数据库、会话、Git 工作区和 S3 的计划变量。
- 阶段 1 首先实际使用 `DATABASE_URL`、`DATABASE_POOL_MAX`、`CMS_AUTH_SECRET`、`CMS_SESSION_COOKIE`、`CMS_SESSION_TTL_HOURS`、`CMS_SECURE_COOKIES`。
- `.env.example` 只有占位值，没有真实密钥。

### 架构设计决定

- PostgreSQL 使用 Drizzle ORM + node-postgres，migration 以已提交 SQL 为准。
- 登录使用 Argon2id + 服务端可撤销会话，不采用长期 JWT。
- 可视化编辑器采用 Milkdown/Crepe，源码模式独立保留 Markdown；不支持的扩展语法进入源码保护流程。
- S3 采用 AWS SDK v3 的通用客户端，图片由服务端 Sharp 转为 WebP。
- CMS Markdown 发布只操作独立 Git 工作区，部署目录保持只读。
- `nuxt-studio` 不符合本项目审核模型；阶段 1 应先禁用生产 Studio，确认后续无需它再移除。

### 测试与构建

- `git diff --check`：通过。
- `npm run wiki:check`：通过，226 个 Wiki 文件检查正常。
- `npm run typecheck`：通过。阶段 0 开始时项目缺少根 `tsconfig.json` 和直接开发依赖，现已按 Nuxt 4 project references 方案补齐。
- 启用严格类型检查后发现的既有空值问题已用类型收窄和空值保护修正，不改变 Wiki 路由行为。
- 普通 `npm run build`：失败，原因为现有 `nuxt-studio` 无法在本地生产构建中识别 GitHub owner/repo。
- 使用公开 CI 仓库标识的基线构建：

  ```bash
  GITHUB_ACTIONS=true \
  GITHUB_REPOSITORY=SDUTVINCI/sdutvinci_web \
  GITHUB_REF_NAME=main \
  npm run build
  ```

  结果：通过，预渲染 540 条路由。存在现有的大 chunk、静态图片解析和计时标签 warning，没有构建错误。

### 已知问题

- 非 CI 环境的普通生产构建被 Nuxt Studio 配置阻断。
- Nuxt Studio 生产鉴权未配置，并与目标 CMS 发布流程冲突。
- `npm audit --omit=dev` 报告现有生产依赖共 20 项（3 low、3 moderate、12 high、2 critical），包括已安装 Nuxt 4.4.5 的已修复公告以及 Nuxt Studio 的旧 Sharp 依赖。阶段 0 未执行可能带来大范围依赖变化的 `npm audit fix`；阶段 1 在鉴权开发前应先更新 Nuxt 到修复版本并禁用/移除生产 Nuxt Studio，阶段 9 再完成全量安全验收。
- 现有成员没有稳定 ID。
- 现有新闻 Frontmatter 与目标通用 Frontmatter 命名不同，后续必须兼容保留。
- Wiki 内容量大，当前生产构建输出非常多且存在 chunk 体积警告。

### 下一阶段注意事项

阶段 1 只做 PostgreSQL、migration、用户/角色/成员基础实体、审计、登录/退出、后台路由保护、基础 layout、个人中心和首个管理员初始化。

1. 开始前重新阅读需求文档、本文和 `docs/ARCHITECTURE.md`。
2. 不实现文章扫描、编辑器、草稿、审核、Git 写入或图片上传。
3. 先为现有前台创建 default layout，再增加 CMS layout，并验证前台视觉结构不变。
4. 将 Nuxt 更新到已修复当前安全公告的兼容版本；禁用生产 Nuxt Studio 后确保普通 `npm run build` 可以直接通过。
5. migration 必须能在空 PostgreSQL 数据库执行；测试使用本地 Docker PostgreSQL，不连接生产库。
6. 首个管理员通过交互式 CLI 创建，密码不进入命令历史、日志或环境示例。
7. API 权限必须服务端校验；客户端 middleware 不能作为唯一保护。

### 禁止修改模块

- 不要改变 Wiki 拼音路径与章节排序逻辑，除非修复有测试证明的兼容问题。
- 不要批量改写 `content/` 中任何 Markdown。
- 不要在部署目录实现 Git 写入。
- 不要把真实数据库、GitHub、SSH 或 S3 密钥提交到仓库。

## 2026-07-25：阶段 0 补充——需求进度清单

### 变更目的

- 将需求文档中代码块之外的无序列表和有序步骤统一转换为 GitHub Markdown 任务清单。
- 增加阶段 0～9 的总体进度清单。
- 勾选已经完成并提交的阶段 0 总进度、任务、范围约束和验收标准。
- 阶段 1～9 及对应的总需求条目保持未勾选，只有在对应阶段实现和验证后才更新。

### 修改文件

- `docs/网站后台（CMS）需求文档_最终完整版.md`
- `docs/CODEX_HANDOVER.md`

### 数据库、API、依赖和环境变量

- 无变更。

### 格式检查

- 代码块之外共有 477 个任务清单条目：19 个已完成，458 个未完成。
- 未发现代码块之外仍使用普通列表格式的任务项。
- `git diff --check`：通过。
- `npm run wiki:check`：通过，226 个 Wiki 文件检查正常。

### 后续维护规则

- 完成某项实现并通过本阶段验证后，把对应条目从 `[ ]` 改为 `[x]`。
- 不得因为“已有部分代码”就提前勾选；总需求条目应在所属阶段验收时同步更新。
- 阶段总体进度只在该阶段全部任务和验收标准完成后勾选。
- 如果验收发现问题，应保持阶段未通过，并将受影响条目恢复为未勾选。

## 2026-07-25：阶段 0 补充更正——限定清单范围

### 更正内容

- 根据维护者要求，复选框只用于需求文档的“十六、Codex 分阶段开发计划”。
- 第一至十五章恢复为普通 Markdown 列表。
- 第十七章“建议的 Codex 单阶段指令模板”及之后章节恢复为普通 Markdown 列表。
- 进度标记说明和阶段 0～9 总体进度清单保留在第十六章内。

### 核对结果

- 第十六章共有 296 个任务清单条目：19 个已完成，277 个未完成。
- 第十六章内没有遗漏普通列表格式的任务项。
- 第十六章之外没有残留任务清单格式。
- 数据库、API、依赖和环境变量均无变更。

## 2026-07-25：阶段 1——PostgreSQL、基础数据模型与用户登录

### 完成状态

- 阶段 1 的实现与自动化验证已完成，等待维护者人工验收。
- 需求文档中阶段 1 的任务、范围约束与验收标准已勾选；总体进度及“等待验收”保持未勾选，验收通过后再更新。
- 未开始阶段 2。

### 数据库与身份认证

- 引入 PostgreSQL、Drizzle ORM、node-postgres 和已提交 SQL migration。
- 建立 `users`、`roles`、`user_roles`、`members`、`user_members`、`sessions`、`audit_logs`。
- migration 初始化 `admin`、`member` 两个系统角色，并可重复执行。
- 密码使用 Argon2id；会话使用 256-bit 随机令牌，数据库只保存 SHA-256 摘要。
- Cookie 使用 `HttpOnly`、`SameSite=Lax`，生产环境由 `CMS_SECURE_COOKIES=true` 开启 `Secure`。
- 写接口执行同源和 CSRF 校验；权限在 API 服务端再次校验，不信任页面中间件或客户端角色。
- 停用用户会撤销其活动会话；最后一名管理员不能被停用或移除管理员角色。
- 首位管理员通过 `npm run cms:admin` 交互式创建。命令不接受参数或环境变量密码，已有管理员时拒绝执行。

### API 与页面

- 新增登录、退出、会话、个人资料和管理员用户 API，路由与 `docs/ARCHITECTURE.md` 的阶段 1 草案一致。
- 新增 `/cms/login`、`/cms`、`/cms/profile`。
- 前台 Header/Footer 从根组件迁入 default layout；CMS 使用独立的认证 layout 和后台 layout。
- 未实现文章、草稿、Git 发布、图片或阶段 2 功能。

### 新增和修改文件

- 配置与依赖：`.env.example`、`package.json`、`package-lock.json`、`nuxt.config.ts`、`drizzle.config.ts`、`vitest.config.ts`。
- 前端入口与样式：`app/app.vue`、`app/assets/css/main.css`、`app/assets/css/cms.css`。
- CMS 前端：`app/composables/useCmsSession.ts`、`app/layouts/default.vue`、`app/layouts/cms.vue`、`app/layouts/cms-auth.vue`、`app/middleware/cms-auth.ts`、`app/middleware/cms-admin.ts`、`app/pages/cms/login.vue`、`app/pages/cms/index.vue`、`app/pages/cms/profile.vue`。
- 数据库：`server/db/client.ts`、`server/db/schema.ts`、`server/db/migrate.ts`、`server/db/migrations/0000_tired_invisible_woman.sql` 及对应 Drizzle meta 文件。
- 服务端认证：`server/services/cms-auth.ts`、`server/utils/cms-config.ts`、`server/utils/cms-security.ts`、`server/utils/cms-http.ts`、`shared/types/cms-auth.ts`。
- API：`server/api/cms/auth/*`、`server/api/cms/profile.*`、`server/api/cms/admin/users/*`。
- 命令与测试：`scripts/cms-admin.ts`、`scripts/cms-migrate.ts`、`tests/cms-auth.integration.test.ts`。
- 文档：`docs/ARCHITECTURE.md`、`docs/CMS_SETUP.md`、`docs/CODEX_HANDOVER.md`、`docs/网站后台（CMS）需求文档_最终完整版.md`。

### 依赖、构建与安全

- Nuxt 更新到 4.5.x，Nuxt Content 更新到 3.15.x。
- 移除 `nuxt-studio`，关闭绕过 CMS 审核流程的第二条写入入口；普通 `npm run build` 已恢复。
- 新增运行依赖：`argon2`、`drizzle-orm`、`pg`、`zod`。
- 新增开发依赖：`drizzle-kit`、`tsx`、`vitest`、`@types/pg`。
- 非强制 `npm audit fix` 已更新可安全升级的间接依赖。剩余公告来自 Nuxt/Nitro 的归档依赖和 Drizzle Kit 的开发期 esbuild 链；自动修复建议会反向降级直接依赖，因此未执行 `--force`，阶段 9 继续复核。

### 环境变量与运行说明

- 阶段 1 使用 `DATABASE_URL`、`DATABASE_POOL_MAX`、`DATABASE_SSL`、`CMS_AUTH_SECRET`、`CMS_SESSION_COOKIE`、`CMS_SESSION_TTL_HOURS`、`CMS_SECURE_COOKIES`、`NUXT_PUBLIC_SITE_URL`。
- `.env.example` 仅包含占位值。
- 初始化、管理员创建、启动和测试步骤见 `docs/CMS_SETUP.md`。

### 验证结果

- `npm run typecheck`：通过。
- `npm run build`：通过；Wiki 检查 226 个文件正常，预渲染 540 条前台路由。
- PostgreSQL 17 临时容器中的 `npm run test:cms`：4 项集成测试全部通过。
- 真实 Nitro API 冒烟测试：未登录会话 401；未登录 `/cms` 跳转 `/cms/login`；member 登录 200；member 访问管理员用户 API 403；资料更新 200；退出 200；已撤销会话 401；admin 登录和用户列表 200。
- 临时测试容器只包含验收数据，阶段结束后删除。

### 人工验收

1. 按 `docs/CMS_SETUP.md` 配置专用 PostgreSQL 与本机 `.env`。
2. 执行 `npm run db:migrate`，再执行 `npm run cms:admin` 创建首位管理员。
3. 执行 `npm run dev`，访问 `/cms/login`。
4. 验证管理员登录、个人资料修改和退出。
5. 如需验证普通成员权限，可用管理员用户 API 创建 `member` 账号，再确认其访问 `/api/cms/admin/users` 返回 403。
6. 验收通过后，勾选阶段 1 总体进度和通用模板中的“等待本阶段验收通过”，再启动阶段 2。

## 2026-07-25：阶段 1 验收修正——维护命令加载 `.env`

### 问题与修正

- 人工验收发现，Nuxt 会自动读取 `.env`，但直接运行的 `tsx` 维护命令不会自动读取，导致已经配置 `.env` 时 `npm run db:migrate` 仍报告缺少 `DATABASE_URL`。
- `db:migrate` 和 `cms:admin` 已增加 `tsx --env-file=.env`，现在会自动读取项目根目录的 `.env`。
- 管理员密码仍只通过隐藏的交互式输入读取，不会写入 `.env`、命令参数或日志。
- 同步更新 `docs/CMS_SETUP.md`。

## 2026-07-25：阶段 1 验收修正——使用稳定账号 ID 登录

### 需求调整

- 维护者确认登录账号应为稳定用户 ID，例如 `dongjiahui`、`dongjiahui1`，而不是邮箱。
- `users` 新增唯一且不可为空的 `account`；允许 3～32 位小写字母或数字，并要求以字母开头。
- 邮箱继续作为唯一联系资料保留，但登录 API 和登录页只接收 `account` 与密码。
- 阶段 2 绑定成员资料时，应优先让 `users.account` 与 `members.member_key` 一致。

### 数据兼容

- 新 migration 会优先使用符合规则的现有显示名称生成账号，其次使用邮箱前缀，最后使用 UUID 派生的安全回退值。
- 发生重名时自动追加数字后缀，形成 `dongjiahui1`、`dongjiahui2`。
- 现有开发数据库已迁移，原管理员的账号为 `dongjiahui`；用户 ID、密码哈希、角色、会话和审计记录均保留。

### 验证

- 空 PostgreSQL 17 数据库中的 migration 与 CMS 身份认证集成测试：4 项全部通过。
- 既有开发数据库 migration：通过，重复执行安全。
- `npm run typecheck`：通过。
- `npm run build`：通过，Wiki 226 个文件检查正常。
- Nitro HTTP 回归：邮箱格式登录请求返回 400；账号登录返回 200 且会话用户携带稳定账号；普通成员访问管理员 API 返回 403。
- 人工验收需改为使用账号 `dongjiahui` 和原密码登录，不再使用邮箱登录。

## 2026-07-25：阶段 1 最终模型修正——认证用户与成员资料分离

### 最终决定

- `users` 只保存认证与授权字段：`id`、`account`、`password_hash`、`status`、时间戳；角色、会话和成员关联继续使用独立关系表。
- 删除 `users.email` 和 `users.display_name`。姓名、头像及其他展示资料只属于 `members`，阶段 2 通过 `users.account = members.member_key` 建立一对一关系。
- 创建首位管理员只输入账号 ID 和密码；管理员创建普通用户也只提交账号 ID、密码和角色。
- 个人中心在阶段 1 只读显示账号、角色和状态。资料编辑由阶段 2 的成员管理承担，因此删除 `PATCH /api/cms/profile`。

### 数据迁移

- 新 migration 删除邮箱、显示名称及邮箱唯一索引，但保留现有用户 ID、账号、密码哈希、状态、角色、会话、成员关联和审计日志。
- 本地现有管理员仍为 `dongjiahui`，原密码不变。
- 已确认现有成员资料包含“董佳辉”，阶段 2 可生成 `member_key: dongjiahui` 后直接建立一对一关联。

### 验证

- 既有开发数据库 migration 连续执行两次：通过；`users` 最终只有 `id`、`account`、`password_hash`、`status` 和时间戳字段。
- 空 PostgreSQL 17 数据库 migration 与 4 项认证集成测试：全部通过。
- `npm run typecheck`、`npm run build`、226 个 Wiki 文件检查：全部通过。
- Nitro HTTP 回归：登录响应不含邮箱或显示名称；只提交账号、密码和角色即可创建用户；普通成员访问管理员 API 返回 403；资料修改路由已移除。

## 2026-07-25：阶段 1——人工验收通过

- 维护者已确认阶段 1 验证完毕，并授权启动阶段 2。
- 需求文档中的阶段 1 总体进度和通用模板“等待本阶段验收通过”已勾选。
- 阶段 1 最终认证模型以提交 `05830f1` 为准：账号 ID + 密码，成员展示资料留给阶段 2 一对一绑定。

## 2026-07-25：阶段 2——成员管理与文章只读管理

### 完成状态

- 阶段 2 的实现、迁移和自动化验证已完成，等待维护者人工验收。
- 阶段 2 任务、范围约束和验收标准已勾选；总体进度及通用模板“等待本阶段验收通过”保持未勾选。
- 未开始阶段 3，未实现文章写入、删除、编辑器、草稿、审核或 Git 写操作。

### 成员资料

- 32 份现有成员 Markdown 均新增稳定 `id`。ID 使用姓名全拼小写；重名依次追加 `1`、`2`，已有 ID 永远优先保留。
- `董佳辉.md` 的稳定 ID 为 `dongjiahui`，开发数据库中的同 ID 管理员已通过 `user_members` 自动绑定。
- 前台成员详情路由改为稳定 ID，例如 `/team/dongjiahui`；旧的姓名路由查询仍作为兼容回退。
- 管理员可在 `/cms/members` 创建成员，并在详情页修改姓名和头像；普通成员只读。稳定 ID 在编辑时不可修改。
- 成员写接口要求 admin、有效会话、同源和 CSRF 校验，并写入审计日志。

### 文章只读索引

- migration `0004_faithful_vindicator.sql` 新增 `articles`，并为 `members` 增加完整 Frontmatter JSONB 元数据。
- 扫描 `content/news` 的 2 篇新闻与 `content/wiki` 的 226 篇 Wiki，共 228 篇文章；列表支持正文/标题搜索、collection 和目录筛选。
- 文章数据库 UUID 与标题分离，同一路径重新扫描或修改标题后 UUID 不变；内容哈希使用 SHA-256。
- `/cms/articles/:id` 先按 UUID 查数据库，再从受控 collection 读取 Markdown，展示 Nuxt Content 渲染预览和 Frontmatter。
- 文件读取使用 `realpath` 并校验目标仍位于 `members`、`news` 或 `wiki` 根目录，忽略符号链接，拒绝绝对路径、`..` 和非 Markdown 文件。

### 命令、依赖与验证

- 新增 `yaml` 直接依赖，用于兼容解析既有 Frontmatter；旧成员文件中的 Tab 缩进只在解析副本中规范化，不会静默改写源文件。
- 新增 `npm run cms:content:sync`，自动读取 `.env`，执行 migration、补充缺失成员 ID 并重建只读文章索引。
- 隔离 PostgreSQL 测试库中的 `npm run test:cms`：2 个测试文件、9 项测试全部通过。
- `npm run typecheck`：通过。
- `npm run build`：通过；Nuxt Content 全量解析 260 个文件，Wiki 检查 226 个文件正常，稳定成员路由成功预渲染。
- 正式开发数据库同步结果：32 名成员、228 篇文章，`dongjiahui` 账号绑定 `dongjiahui` 成员。
- Nitro HTTP 冒烟：`/team/dongjiahui` 返回 200；未登录 `/cms/articles` 跳转登录；未登录文章 API 返回 401。

### 人工验收

1. 执行 `npm run dev`，使用现有账号 `dongjiahui` 和原密码登录。
2. 打开 `/cms/members`，确认可看到 32 名成员，“董佳辉”显示“已绑定 @dongjiahui”。
3. 打开任一成员详情，修改姓名或头像后保存，再刷新确认稳定 ID 不变；如不想改真实资料，可只查看，不必提交。
4. 打开 `/cms/articles`，确认显示 228 篇文章；分别搜索一个新闻正文关键词，并选择 `wiki/...` 目录筛选。
5. 打开任一文章，确认正文为只读渲染预览，右侧 Frontmatter 与源文件一致。
6. 验收通过后勾选阶段 2 总体进度和通用模板“等待本阶段验收通过”，再启动阶段 3。

## 2026-07-25：阶段 2——人工验收通过

- 维护者已确认阶段 2 验收通过。
- 需求文档中的阶段 2 总体进度和通用模板“等待本阶段验收通过”已勾选。
- 阶段 2 实现以提交 `ad0ebca` 为准：32 份稳定成员 ID、成员管理、228 篇文章只读索引和安全预览。
- 阶段 3 尚未启动，需等待维护者明确指令。

## 2026-07-25：阶段 3——Markdown 编辑器与草稿系统

### 完成状态

- 阶段 3 实现、迁移、自动化验证和维护者人工验收均已完成。
- 阶段 3 任务、范围约束、验收标准、总体进度及通用模板“等待本阶段验收通过”均已勾选。
- 未开始阶段 4；没有审核、编辑锁、正式发布、图片上传或应用内 Git 写操作。

### 草稿数据与权限

- migration `0005_exotic_bruce_banner.sql` 新增 `drafts` 和 `draft_authors`。
- 草稿保存 `title`、`description`、正文、保留 Frontmatter、作者关系、正式文章 `base_content_hash`、创建者和乐观版本号。
- 新文章 `article_id` 与 `base_content_hash` 为空，只存在于 PostgreSQL；已有文章草稿复制正式内容但不写回 `content/`。
- 同一用户对同一正式文章只有一个草稿；再次点击编辑会恢复原草稿。`/cms/drafts` 可恢复新文章和已有文章草稿。
- 草稿只能由创建者读取或保存；跨用户读取返回不存在。每次成功保存递增版本，旧页面保存返回 409。

### 编辑器与 Frontmatter

- 新增 Milkdown Crepe 7.21.3 客户端可视化编辑器和独立 Markdown 源码编辑区。
- 支持标题、普通文本、粗斜体、删除线、引用、有序/无序/任务列表、链接、图片链接、表格、行内代码、代码块和分割线。
- 所有文章均可进入混合可视化模式；HTML/Vue、Jekyll 模板和 MDC 扩展显示为只读保护区域，普通 Markdown 保持可编辑。
- 保护区域使用 ProseMirror 原子节点，拦截删除或改写，并在序列化时恢复原始源码。
- 保存 API 使用 strict schema，只接受 `title`、`description`、`body`、`authorKeys`、`version`；伪造 `contributors`、`updatedAt`、`publishedAt` 会返回 400。
- 约 1.2 秒无输入后自动保存，也可手动保存；页面离开前有未保存内容时由浏览器提示。

### 页面与 API

- 页面：`/cms/articles/new`、`/cms/drafts`、`/cms/drafts/:id`；正式文章详情新增“编辑草稿”入口。
- API：`GET|POST /api/cms/drafts`、`GET|PUT /api/cms/drafts/:id`、`GET /api/cms/articles/:id/draft`。
- 编辑页明确不提供审核、发布、图片上传或 Git 操作入口。

### 验证结果

- 隔离 PostgreSQL 测试库与编辑器逻辑：4 个测试文件、18 项测试全部通过。
- 覆盖新文章不写文件、已有文章草稿不改变源 Markdown、刷新恢复、作者关系、基线哈希、版本冲突、资源所有权、系统字段伪造和扩展语法保护。
- `npm run typecheck`：通过。
- `npm run build`：通过；Wiki 226 个文件检查正常，Nuxt Content 260 个文件正常，Nitro node-server 构建完成。
- 真实 Nitro HTTP：登录 200、创建草稿 200、读取恢复 200、保存 200、版本升至 2、刷新内容一致；伪造 `updatedAt` 返回 400。
- 正式开发数据库已执行 migration；HTTP 冒烟只使用隔离测试库，完成后删除。

### 人工验收

1. 执行 `npm run dev`，用现有 `dongjiahui` 账号登录。
2. 在文章详情点击“编辑草稿”，修改正文后等待约 1.2 秒，确认状态变为“已保存”。
3. 刷新页面或进入“草稿”列表重新打开，确认修改内容恢复，前台原文章仍不变。
4. 在普通 Markdown 中切换可视化和源码模式，确认内容不丢失。
5. 选择包含 `<NuxtLink>` 的 Wiki 文章创建草稿，确认仍能进入可视化模式；组件位置显示只读保护标签，周围内容可以编辑。
6. 新建一篇文章草稿，确认“草稿”列表可恢复，且仓库 `content/` 没有新增文件。
7. 验收通过后勾选阶段 3 总体进度和通用模板“等待本阶段验收通过”，再启动阶段 4。

## 2026-07-25：阶段 3 验收前修正——强制隔离测试数据库

- 最终回归测试曾错误地继承普通 `DATABASE_URL`，测试清理逻辑因此清空本地开发库的 CMS 用户、成员索引、文章索引和审计记录。
- PostgreSQL 未配置可用备份或 WAL 归档，原管理员密码哈希无法恢复；事发时开发库没有用户草稿。
- 已从仓库内容重新同步 32 名成员和 228 篇正式文章索引。管理员需由维护者通过 `npm run cms:admin` 重新创建并设置新密码，再执行一次 `npm run cms:content:sync` 建立账号与同 ID 成员的关联。
- 所有 CMS 集成测试现在只接受 `TEST_DATABASE_URL`，数据库名称必须包含独立的 `test` 单词；仅有普通 `DATABASE_URL` 时 15 项测试全部跳过。
- 修正后在 `vinci_cms_test` 隔离库中重新执行 15 项测试并全部通过；随后删除测试库。再次带普通开发库环境运行时，15 项测试全部跳过，开发库的 32 名成员和 228 篇文章计数保持不变。

## 2026-07-25：阶段 3 验收修正——可视化编辑器初始化

- 草稿页误用了不存在的 `CmsCmsMarkdownVisualEditor` 组件名，导致可视化编辑器未挂载，界面一直停留在无损往返检查。
- 已改为显式导入和挂载 `CmsMarkdownVisualEditor`，并增加 15 秒初始化超时；失败时恢复原 Markdown 并安全返回源码模式。
- 修正后 `npm run typecheck` 和 `npm run build` 均通过。

## 2026-07-25：阶段 3 验收修正——所有文章混合可视化

- 原先的全局正则会把代码块中的 `#include <...>`、XML 示例和 `<https://...>` 自动链接误判为组件，并因一处扩展语法拒绝整篇文章进入可视化模式。
- 现在先用 Remark AST 只识别真正的 HTML/Vue 节点，再由 Milkdown 自定义节点显示为标明类型的保护标签；Jekyll/MDC/未知指令同样进入保护节点。
- 保护节点是不可编辑的 ProseMirror 原子节点，事务守卫会拒绝删除或改写；周围普通 Markdown 可正常编辑，序列化时恢复原始扩展源码。保护区域本身仍可在源码模式中显式修改。
- 真实 Chrome 验证覆盖 `NuxtLink`、`<br>`、HTML 块、模板指令和代码块：扩展源码往返完整、普通段落编辑成功、保护节点删除被拦截。
- 隔离数据库与纯逻辑测试共 4 个文件、18 项全部通过，其中逐篇预处理了现有 228 篇新闻/Wiki 正文；`npm run typecheck` 和 `npm run build` 均通过。

## 2026-07-25：阶段 3——人工验收通过

- 维护者已完成文章新建、草稿保存与恢复、源码/可视化切换，以及特殊语法保护的人工测试，并确认阶段 3 验收通过。
- 需求文档中的阶段 3 总体进度和通用模板“等待本阶段验收通过”已勾选。
- 阶段 3 实现以提交 `23d838e` 为基础，并包含测试数据库隔离 `e7698a3`、编辑器挂载修正 `9f8f7f0` 和所有文章混合可视化 `4fa5fc5`。
- 阶段 4 尚未开始；下一个 Codex 对话应直接从审核流程、编辑锁与版本冲突开始，不再重复阶段 3 工作，也不得提前实现阶段 5 的正式发布和 Git 写入。

## 2026-07-25：阶段 4——审核流程、编辑锁与版本冲突

### 完成状态

- 阶段 4 实现、migration 和自动化验证已完成，等待维护者人工验收。
- 阶段 4 任务、范围约束和验收标准已勾选；总体进度及通用模板“等待本阶段验收通过”保持未勾选。
- 未开始阶段 5；没有正式 Markdown 写入、Git Commit/Push、发布记录或历史版本恢复。

### 数据库与状态机

- migration `0006_sturdy_thunderball.sql` 将草稿状态约束扩展为 `draft`、`pending_review`、`rejected`、`approved`、`published`、`withdrawn`。
- 新增 `review_events`，只追加记录提交、撤回、驳回、通过、恢复编辑和手动重新同步，保留操作者、前后状态、驳回原因、元数据和时间。
- 新增 `edit_locks`，保存锁目标、持有人、独立租约 ID、获取时间、心跳时间和过期时间；已有文章按 `articleId` 互斥，新文章按 `draftId` 互斥。
- 状态流为 `draft → pending_review → approved/rejected/withdrawn`；`rejected` 和 `withdrawn` 必须显式恢复为 `draft`。`published` 只为阶段 5 预留，本阶段没有进入该状态的入口。
- `pending_review` 和 `approved` 不允许保存。提交时释放编辑锁；管理员审核页面不直接修改待审核内容。

### 审核、冲突与编辑锁

- 普通成员可保存、提交审核，并在管理员作出决定前撤回；驳回原因会在草稿页展示。
- 管理员可在 `/cms/reviews` 查看待审核列表，并在详情页比较 `title`、`description`、`authors` 和正文行差异，填写原因驳回或审核通过。
- 管理员可审核自己提交的内容，适配只有一名管理员的第一版部署；所有决定仍进入 `review_events`。
- 编辑页挂载后获取租约，每 20 秒心跳，90 秒未续期自动失效。站内离开主动等待释放，浏览器完成关闭时使用 keepalive 请求尽力释放。
- 其他用户持锁时页面保持只读并显示持有人。管理员接管会轮换租约，使旧页面无法心跳或保存，并向 `audit_logs` 写入原持有人、接管人、目标和可选原因。
- 草稿保存必须同时通过乐观版本号和有效编辑租约校验，旧页面或被接管页面不能覆盖新内容。
- 提交和审核通过前直接读取正式 Markdown 重新计算 SHA-256，不依赖可能过期的 `articles.content_hash`。
- 冲突时返回“当前文章已有更新，请重新同步后再发布。”，保持草稿和正式 Markdown 不变。用户需撤回、手动对照差异整理，然后明确确认当前正式哈希为新基线；系统不自动合并。
- 阶段 5 在真正写入前仍必须再次执行实时基线检查，不能把阶段 4 的审核检查当作发布锁。

### 页面与 API

- 页面：更新 `/cms/drafts` 和 `/cms/drafts/:id`；新增 `/cms/reviews`、`/cms/reviews/:id`。
- 草稿流程 API：`submit`、`withdraw`、`reopen`、`resync`、`comparison`、`review-events`。
- 编辑锁 API：`GET|POST|PUT|DELETE /api/cms/drafts/:id/lock` 与 `POST /api/cms/drafts/:id/lock/takeover`。
- 审核 API：`GET /api/cms/reviews`、`GET /api/cms/reviews/:id`、`approve`、`reject`；列表、详情和决定接口都在服务端要求 `admin`。
- `POST /api/cms/drafts/:id/publish` 不存在；普通成员不能绕过阶段 5 发布。

### 新增和修改文件

- 数据库：`server/db/schema.ts`、`server/db/migrations/0006_sturdy_thunderball.sql` 及 Drizzle meta。
- 服务与类型：`server/services/cms-edit-locks.ts`、`server/services/cms-reviews.ts`、`server/services/cms-drafts.ts`、`server/services/cms-articles.ts`、`server/utils/cms-workflow-http.ts`、`server/utils/cms-draft-validation.ts`、`shared/types/cms-edit-locks.ts`、`shared/types/cms-reviews.ts`、`shared/types/cms-drafts.ts`。
- API：`server/api/cms/drafts/[id]/*` 的锁与工作流路由、`server/api/cms/reviews/*`，以及既有草稿读取/保存路由。
- 页面与样式：`app/pages/cms/drafts/*`、`app/pages/cms/reviews/*`、`app/layouts/cms.vue`、`app/assets/css/cms.css`。
- 测试：新增 `tests/cms-workflow.integration.test.ts`，并更新阶段 1～3 数据库测试的清理表和草稿锁前置条件。
- 配置与文档：`.env.example`、`package.json`、`package-lock.json`、`docs/ARCHITECTURE.md`、`docs/CMS_SETUP.md`、本文件和需求进度清单。

### 依赖与环境

- 新增直接依赖 `diff` 8.0.x，用于服务端生成逐行正文差异。
- 应用运行没有新增强制环境变量。`.env.example` 现在明确列出仅用于集成测试的 `TEST_DATABASE_URL`。
- 集成测试继续只接受 `TEST_DATABASE_URL`，且数据库名称必须包含独立的 `test` 单词；本阶段所有清理都只在 `vinci_cms_test` 中执行。

### 自动化验证

- PostgreSQL 17 隔离库中的 `npm run test:cms`：5 个测试文件、21 项全部通过。
- 覆盖完整状态流、驳回原因、待审核列表、编辑互斥、管理员接管审计、旧租约失效、主动释放、超时释放、实时哈希冲突、手动重新同步、审核期间再次冲突，以及正式 Markdown 不被业务流程修改。
- `npm run typecheck`：通过。
- `npm run build`：通过；Wiki 226 个文件检查正常，Nuxt Content 260 个文件正常，Nitro node-server 构建完成。
- 真实构建 HTTP 冒烟：成员提交后为 `pending_review`；成员访问审核列表和审核通过接口均为 403；发布路由为 404；管理员看到待审核记录并成功改为 `approved`。
- HTTP 冒烟和集成测试只使用端口 55432 的临时 `vinci_cms_test`，未连接普通 `DATABASE_URL`。

### 人工验收前置

1. 使用开发数据库执行 `npm run db:migrate`，应用 migration `0006_sturdy_thunderball.sql`。
2. 执行 `npm run dev`，准备一个普通成员账号和一个管理员账号；同一管理员也允许自行提交并审核。
3. 按最终回复中的步骤验证保存、提交、撤回、驳回、继续编辑、审核通过、双浏览器锁、管理员接管和版本冲突。
4. 验收通过后勾选阶段 4 总体进度和通用模板“等待本阶段验收通过”，再启动阶段 5。

### 下一阶段注意事项

- 阶段 5 只能发布 `approved` 草稿，并且写入前必须重新读取正式 Markdown 校验 `base_content_hash`。
- 只有 Markdown 原子写入、Git Commit 和 Git Push 全部成功后才能进入 `published`；失败时保留 `approved` 草稿并记录原因。
- 不要绕过阶段 4 的状态机、审核事件或锁租约校验；不要把 PostgreSQL 草稿正文当作正式内容源。
- 阶段 5 才实现 `publishedAt`、`updatedAt`、`contributors`、独立 Git 工作区、发布记录和历史恢复。

## 2026-07-25：阶段 4——人工验收通过

- 维护者已完成阶段 4 的草稿保存、提交与撤回、驳回原因、继续编辑、管理员审核通过、双用户编辑锁、管理员接管和锁超时释放等人工验收，并确认结果通过。
- “可选冲突验收”未人工执行；正式 Markdown 实时哈希冲突、手动重新同步和审核期间二次冲突已由隔离 PostgreSQL 集成测试覆盖，不影响本阶段验收结论。
- 需求文档中的阶段 4 总体进度已勾选；通用模板“等待本阶段验收通过”此前已是完成状态。
- 阶段 4 实现以提交 `27a2cda` 为准。
- 阶段 5 尚未启动，必须等待维护者明确指令；不得提前写 Markdown、执行 Git Push 或实现历史版本恢复。

## 2026-07-25：阶段 5——正式发布、Git 历史与版本恢复

### 完成状态

- 阶段 5 实现、migration 和自动化验证已完成，等待维护者人工验收。
- 阶段 5 任务、范围约束和验收标准已勾选；总体进度保持未勾选，人工验收通过后再更新。
- 未开始阶段 6；没有图片上传、S3 SDK、媒体表或生产自动部署。

### 发布事务与安全边界

- migration `0007_bizarre_night_thrasher.sql` 新增 `publish_records`，记录草稿/文章、操作人、审核人、操作类型、状态、commit hash、文章路径、提交信息、失败原因和完成时间。
- 发布 API 仅允许管理员发布 `approved` 且版本匹配的草稿；审批人取最近一次 `approved` 审核事件，操作人与审核人分别入库。
- `CMS_GIT_WORKTREE` 是部署目录之外的独立 clone。服务在 PostgreSQL advisory lock 内串行执行 fetch、分支同步、实时基线校验、原子写文件、commit 和非强制 push。
- 工作区存在未提交修改、remote URL 不匹配、路径越界、现有文章基线变化或新文章目标冲突时都会停止发布。
- Git Push 成功后才在同一数据库事务中登记/更新文章、把草稿改为 `published`、保存 commit hash 和审计日志。
- Push 失败时远端不变，失败原因写入 `publish_records`，草稿保持 `approved`；隔离工作区重置到远端分支后可直接重试。
- 阶段 5 集成测试使用临时本地裸 Git 仓库和 `pre-receive` 拒绝 hook，没有读取或推送真实 GitHub 远端。

### Markdown 与 Frontmatter

- 正式 Markdown 由保留字段、草稿 `title`/`description`/`authors` 和正文组合生成，写入后再次完整解析校验。
- 第一次发布生成 `publishedAt`，后续发布保留原值；每次发布更新 `updatedAt`。
- 草稿创建者不是作者时，其稳定成员 key 自动追加到 `contributors`；现有 contributors 去重保留。
- 空 description 从去除常见 Markdown 标记后的首个非空段落生成；未知 Frontmatter 字段保留。
- 新文章可由管理员指定 collection 内相对 `.md` 路径；留空时按日期/标题/草稿短 ID 生成不易冲突的安全路径。现有文章不允许借发布操作移动或改名。

### 历史与恢复

- 文章详情新增“版本历史”，支持提交列表、查看完整历史 Markdown、任意两个提交的逐行差异。
- 管理员可恢复非当前历史版本。服务读取指定历史文件内容，创建并推送一个新的 restore commit；不删除提交、不 force push。
- 历史和恢复 API：
  - `GET /api/cms/articles/:id/history`
  - `GET /api/cms/articles/:id/versions/:commit`
  - `GET /api/cms/articles/:id/diff?from=...&to=...`
  - `POST /api/cms/articles/:id/versions/:commit/restore`
- 正式发布入口为 `POST /api/cms/drafts/:id/publish`，服务端要求管理员、同源与 CSRF。

### 验证结果

- PostgreSQL 17 隔离库中的 `npm run test:cms`：6 个测试文件、26 项全部通过。
- 阶段 5 覆盖发布成功、首次发布时间保留、更新时间与 contributors、未知 Frontmatter、部署目录隔离、远端拒绝 Push、失败状态与原因、管理员重试、新文章默认路径、历史查看、版本差异、恢复新提交和已发布文章进入下一轮编辑。
- `npm run typecheck`：通过。
- `npm run build`：通过；Wiki 226 个文件检查正常，Nuxt Content 260 个文件处理正常，Nitro node-server 构建完成。
- 所有数据库清理只发生在 `TEST_DATABASE_URL` 指向的 `vinci_cms_test`；普通 `DATABASE_URL` 未连接或修改。

### 人工验收前置与步骤

1. 在开发/验收数据库执行 `npm run db:migrate`，应用 migration `0007_bizarre_night_thrasher.sql`。
2. 确认 `.env` 的 `CMS_GIT_WORKTREE` 是部署目录之外、CMS 服务账号可写的路径；`CMS_GIT_REMOTE_URL`、remote、branch 和 Git 作者配置正确。
3. 若使用 SSH，准备只供 CMS 服务读取且对仓库有 push 权限的私钥，并使 `CMS_GIT_SSH_KEY_PATH` 指向它；先用同一系统账号执行 `git ls-remote` 验证连通性。
4. 启动后台，把一篇草稿提交并审核通过；在审核详情点击正式发布，确认显示 commit hash，远端目标分支出现同一 Markdown。
5. 检查 `publishedAt`、`updatedAt`、`contributors` 和保留字段；确认草稿状态为 `published`。
6. 从文章详情进入版本历史，查看内容并比较两个提交；恢复一个旧版本，确认远端新增 restore commit 且后续历史仍存在。
7. Push 失败场景可选：临时撤销验收仓库写权限或使用拒绝 Push 的测试分支，确认页面提示失败、草稿仍为 `approved`；恢复权限后在同页重试成功。
8. 阶段 5 不含自动部署。用现有人工部署方式拉取刚推送的提交并启动前台，确认对应新闻/Wiki 路由展示最新内容。
9. 验收通过后只勾选阶段 5 总体进度，再启动阶段 6。

## 2026-07-25：阶段 5 验收配置——本地 Git 发布身份

- 维护者已完全按照阶段 5 指引完成本机发布环境配置：
  - 为 `SDUTVINCI/sdutvinci_web` 创建并添加带写权限的专用 GitHub Deploy Key。
  - 私钥保存为 `/home/tungchiahui/.ssh/vinci_cms_deploy`，`.env` 的 `CMS_GIT_SSH_KEY_PATH` 已指向该文件。
  - GitHub 主机密钥已加入当前用户的 `known_hosts`。
  - `CMS_GIT_WORKTREE` 已改为部署目录之外的 `/home/tungchiahui/.local/share/vinci-cms/worktree`，父目录存在且当前用户可写。
  - `ssh -T` 已返回 `Hi SDUTVINCI/sdutvinci_web! You've successfully authenticated`。
  - 使用同一私钥执行 `git ls-remote` 已成功读取 `refs/heads/main`。
- 第一次人工发布尚未执行 Git clone/push：配置解析先因 `CMS_GIT_AUTHOR_EMAIL=cms@localhost` 被过严的公网邮箱校验拒绝，草稿按设计保持 `approved`。
- 已修正 Git 作者邮箱校验：接受 Git 常用的 `local-part@host` 格式，包括项目 `.env.example` 的默认值 `cms@localhost`，同时继续拒绝空白、尖括号或缺少 `@` 的值；集成测试改用该默认值防止回归。
- 验收前还需先同步代码分支：GitHub `main` 当前为 `ad0ebca`，本地阶段 3～5 提交位于其后且本地 HEAD 为 `e471889`。在本地阶段提交推送到 GitHub 之前，不要重试 CMS 发布，以免内容提交先落到旧远端基线。

## 2026-07-25：阶段 5 验收修正——版本历史页面路由

- 维护者成功重试正式发布：`wiki/2025-07-01-Nuxt.js网站框架/index.md` 已由 CMS 推送为提交 `00c0867`，`publish_records` 成功记录包含相同 commit hash；此前邮箱校验失败记录仍按设计保留。
- 人工验收发现文章详情的“版本历史”入口无法打开。Git 历史服务本身可正常返回该文件的两个提交，API 路由也存在；问题位于 Nuxt 页面路由生成。
- 原目录同时使用叶子页面 `app/pages/cms/articles/[id].vue` 和子页面 `app/pages/cms/articles/[id]/history.vue`，Nuxt 只注册了详情路由，没有注册历史页面路由。
- 已把详情页面移动为 `app/pages/cms/articles/[id]/index.vue`。文章详情 URL 保持 `/cms/articles/:id` 不变，同时构建路由表现在明确包含 `cms-articles-id-history` → `/cms/articles/:id/history`。
- 修正后 `npm run typecheck` 与 `npm run build` 均通过。开发服务器需要完整重启，才能重新扫描新增的嵌套页面结构。

## 2026-07-25：阶段 5——人工验收通过

- 维护者已确认阶段 5 全部人工验收成功。
- 验收覆盖专用 SSH Deploy Key 与隔离工作区、审核通过后的正式 Git 发布、远端 Markdown/commit 一致、发布失败保留草稿与成功重试、前台最新内容、历史列表、历史 Markdown、版本差异和恢复旧版本的新提交。
- 验收期间发现的 Git 作者邮箱校验和版本历史页面路由问题已分别由提交 `99bcf2e`、`2ed7b83` 修正，并完成类型检查、自动化测试和构建回归。
- 正式发布提交 `00c0867` 证明 Git Push 成功后数据库发布记录、远端内容和 commit hash 一致；最初失败记录仍保留用于审计。
- 需求文档中的阶段 5 总体进度已勾选。阶段 5 实现以 `e471889` 为基础，包含验收修正 `99bcf2e` 和 `2ed7b83`。
- 阶段 6 尚未启动；不得提前实现图片上传、WebP 转换、S3 兼容对象存储或媒体记录。

## 2026-07-25：阶段 6——图片处理与 S3 兼容对象存储

### 完成状态

- 阶段 6 实现、migration 和自动化验证已完成，等待维护者人工验收。
- 阶段 6 任务与验收标准已勾选；总体进度保持未勾选，人工验收通过后再更新。
- 未开始阶段 7；没有前台“编辑本文”、软删除、后台统计完善或完整媒体库。

### 对象存储与图片安全

- 新增直接依赖 `@aws-sdk/client-s3` 和 `sharp`。服务端通过 Endpoint、Region、Bucket、凭据、`forcePathStyle` 和公开 URL 前缀适配 AWS S3、腾讯云 COS、MinIO 等 S3 兼容实现，业务代码没有厂商分支。
- 上传 API 只接受 JPEG、PNG、WebP。声明 MIME 必须与 Sharp 实际解码格式一致；空文件、损坏图片、不支持格式和超限文件均会被拒绝。
- 图片在 Nitro 服务端自动旋转、限制宽高、禁止放大并转为 WebP。默认最大原图 10 MiB、最大宽高 2560 px、质量 82，均可通过环境变量调整。
- 对象 key 使用安全前缀、UTC 年月、草稿 UUID 和随机 UUID 生成，不拼接用户文件名；原文件名只作为经过控制字符和路径分隔符清理后的审计元数据保存。
- S3 Access Key 和 Secret Key 只由服务端配置读取，响应只包含公开 URL 和必要图片元数据。对象使用不可变一年缓存头。
- 图片上传前后都校验草稿处于 `draft`、资源权限和有效编辑租约。若 S3 成功后租约失效或数据库写入失败，会尽力执行 `DeleteObject` 清理刚上传的对象。

### 数据库、API 与编辑器

- migration `0008_aberrant_titanium_man.sql` 新增 `media_assets`，记录对象 key、公开 URL、上传者、上传时间、关联草稿、原始文件名/MIME/大小，以及输出 WebP 的宽高和大小；数据库不保存二进制。
- 新增 `POST /api/cms/media`，使用登录会话、同源和 CSRF 校验；请求为单图片 `multipart/form-data`，必须携带草稿 ID 和编辑租约 ID。
- 草稿编辑页支持文件选择、多图顺序上传、拖拽图片和粘贴截图。上传成功后，源码模式插入当前光标位置，可视化模式通过 Milkdown selection 插入，并继续触发现有草稿自动保存。
- 第一版没有媒体列表、媒体搜索、复用或删除界面，符合阶段 6 的范围限制。

### 新增和修改文件

- 依赖与配置：`package.json`、`package-lock.json`、`.env.example`。
- 数据库：`server/db/schema.ts`、`server/db/migrations/0008_aberrant_titanium_man.sql` 及对应 Drizzle meta。
- 服务端：`server/utils/cms-media-config.ts`、`server/services/cms-media.ts`、`server/api/cms/media.post.ts`。
- 共享类型：`shared/types/cms-media.ts`。
- 编辑器与样式：`app/components/cms/CmsMarkdownVisualEditor.client.vue`、`app/pages/cms/drafts/[id].vue`、`app/assets/css/cms.css`。
- 测试：`tests/cms-media.integration.test.ts`，并把它加入 `npm run test:cms`。
- 文档：`.env.example`、`docs/ARCHITECTURE.md`、`docs/CMS_SETUP.md`、本文件和需求进度清单。

### 新增环境变量

- 必需：`S3_ENDPOINT`、`S3_REGION`、`S3_BUCKET`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`、`S3_PUBLIC_BASE_URL`。
- 有默认值：`S3_FORCE_PATH_STYLE=false`、`S3_KEY_PREFIX=images`、`CMS_IMAGE_MAX_BYTES=10485760`、`CMS_IMAGE_MAX_WIDTH=2560`、`CMS_IMAGE_MAX_HEIGHT=2560`、`CMS_IMAGE_WEBP_QUALITY=82`。
- 图片配置独立延迟解析；没有配置 S3 时，阶段 1～5 的登录、浏览、草稿、审核和 Git 发布功能仍可运行，只有图片上传返回明确的配置错误。

### 自动化验证

- PostgreSQL 17 临时隔离库中的 `npm run test:cms`：7 个测试文件、29 项全部通过。
- 阶段 6 覆盖真实 PNG/JPEG 解码、WebP 转换、1600×900 限制为 800×450、随机安全 key、公开 URL、数据库媒体记录、密钥不出现在响应、不支持 MIME、声明/实际格式不一致、损坏图片、超限文件、S3 失败不写库，以及上传后租约失效的对象删除补偿。
- 测试只使用 `TEST_DATABASE_URL` 指向的 `vinci_cms_test`，对象存储使用内存模拟客户端；普通 `DATABASE_URL` 和真实 S3 均未连接或修改。
- `npm run typecheck`：通过。
- `npm run build`：通过；Wiki 226 个文件检查正常，Nuxt Content 260 个文件正常，Nitro node-server 构建完成。构建中的静态图片解析、计时标签和既有 Git bigint target warning 均为阶段 6 前已有警告。

### 人工验收前置

1. 在开发/验收数据库执行 `npm run db:migrate`，应用 migration `0008_aberrant_titanium_man.sql`。
2. 按 `docs/CMS_SETUP.md` 配置测试 Bucket、服务端 S3 凭据和可公开读取的 `S3_PUBLIC_BASE_URL`；不要使用生产 Bucket。
3. 重启应用，打开处于 `draft` 且已取得编辑锁的草稿，依次验证选择、拖拽、粘贴、WebP URL、自动插入、自动保存和前台发布后显示。
4. 验证 GIF/文本伪装图片和超过 `CMS_IMAGE_MAX_BYTES` 的文件被拒绝，浏览器网络响应中没有 Access Key 或 Secret Key。
5. 人工验收通过后只勾选阶段 6 总体进度，再等待维护者明确启动阶段 7。

## 2026-07-25：阶段 6 验收修正——阻止粘贴图片重复插入

- 人工验收发现，在可视化编辑器中粘贴截图时，Milkdown 内置粘贴逻辑会先插入本地 `blob:` 图片，页面上传流程随后再插入 S3 URL，导致正文中出现两张图片。
- 图片粘贴与拖拽事件现改为在编辑工作区的捕获阶段处理；识别到图片文件后，在事件到达 Milkdown 前阻止默认行为和后续传播，只保留服务端上传完成后插入的 S3 WebP URL。
- 文件选择上传不受影响；非图片剪贴板内容继续由编辑器正常处理。

## 2026-07-25：阶段 6 验收修正——兼容主流图片扩展名与真实编码不一致

- 人工验收文件 `D9CB99404DEDEA62C30A6A1A754204C4.png` 的扩展名和浏览器声明为 PNG，但 `file` 与 Sharp 均确认真实内容是 1072×1070 的标准 JPEG；原先“声明 MIME 必须与实际编码完全一致”的规则因此误拒绝了可安全处理的图片。
- 上传仍只接受浏览器声明属于 JPEG/JPG、PNG、WebP 的文件，但最终格式以 Sharp 的实际解码结果为准。JPEG/JPG、PNG、WebP 之间扩展名或 MIME 标错时可以正常转为 WebP；文本伪装图片、损坏内容和其他不支持格式仍会被拒绝。
- 文件选择器显式接受 `.jpg`、`.jpeg`、`.png`、`.webp`，服务端同时兼容少数客户端使用的 `image/jpg` 别名。
- 新增“JPEG 内容以 PNG 文件名/MIME 上传”的回归测试；隔离 `TEST_DATABASE_URL` 中完整 CMS 测试现为 7 个文件、30 项全部通过，类型检查和生产构建通过。

## 2026-07-25：阶段 6 验收修正——支持静态和动态 GIF

- GIF 已加入文件选择、拖拽、粘贴和服务端实际格式白名单，统一转为 WebP。
- Sharp 以 `animated: true` 读取 GIF；动态 GIF 输出继续保留帧数、每帧延迟和循环设置，数据库宽高记录单帧尺寸而不是所有帧垂直拼接后的总高度。
- 新增双帧动态 GIF 转换回归测试，确认输出仍为双帧动态 WebP；隔离 `TEST_DATABASE_URL` 中完整 CMS 测试现为 7 个文件、31 项全部通过，类型检查和生产构建通过。

## 2026-07-25：阶段 6 验收修正——图片处理进度预览

- 选择、拖入或粘贴图片后立即显示本地缩略图，并在图片上覆盖“等待处理”或“正在转换并上传”状态与加载动画。
- 服务端返回后，预览切换为对象存储中的 WebP 并短暂显示“上传完成”；失败时在对应图片上显示“上传失败”，多图上传会继续处理其余文件。
- 隔离 `TEST_DATABASE_URL` 中完整 CMS 测试仍为 7 个文件、31 项全部通过，类型检查和生产构建通过。

## 2026-07-25：阶段 6 人工验收完成

- 维护者在真实 S3 兼容对象存储配置下完成了图片选择、粘贴、格式兼容、GIF 和处理进度等验收，并在验收过程中反馈的问题修复后确认收尾。
- 阶段 6 总体进度已勾选；阶段 7 尚未启动，不得在维护者明确发起新阶段前实现阶段 7 或后续内容。
- 阶段 6 实现提交为 `0d162ef`，随后已通过合并提交 `b77f738` 纳入后台产生的远端 Wiki 更新；本地分支尚未推送。

## 2026-07-25：阶段 7——前台联动、删除策略与后台完善

### 完成状态

- 阶段 7 的实现、migration、隔离数据库测试、类型检查和生产构建已完成，等待维护者人工验收。
- 需求文档中阶段 7 的任务、范围约束和验收标准已勾选；阶段 7 总体进度保持未勾选，人工验收通过后再更新。
- 没有实现阶段 8 的 Docker、自动部署、备份或迁移内容，也没有重复实现阶段 6 的图片处理。

### 删除策略与数据库

- migration `0009_unique_moira_mactaggert.sql` 为 `articles`、`drafts` 增加 `deleted_at` 与删除操作者字段，并把草稿唯一索引改为仅约束未删除草稿。
- 新增 `article_deletion_events`，记录正式文章删除/恢复操作、来源 Commit、结果 Commit、路径、操作者和元数据。
- 草稿删除只更新 PostgreSQL 软删除字段；本人或管理员可以恢复，删除/恢复均写入 `audit_logs`，删除时只释放删除草稿持有者或当前管理员持有的编辑锁。
- 正式文章删除只允许管理员。服务在独立 CMS Git 工作区内校验当前内容哈希、删除 Markdown、Commit、Push 成功后才标记数据库软删除；Push 失败会重置工作区且不改变数据库状态。
- 正式文章恢复从删除前来源 Commit 读取 Markdown，写入、Commit、Push 后清除软删除状态；历史 Commit 不删除、不 force push。

### API 与页面

- 新增 `GET /api/cms/dashboard`，返回正式文章、删除文章、草稿状态、待审核和成员统计。
- 新增 `GET /api/cms/articles/resolve?publicPath=...`，供前台编辑按钮把公开路径解析为稳定文章 ID。
- 新增 `POST /api/cms/articles/:id/delete` 与 `POST /api/cms/articles/:id/restore-deleted`，服务端固定要求管理员、同源和 CSRF。
- 新增 `DELETE /api/cms/drafts/:id`、`POST /api/cms/drafts/:id/delete` 和 `POST /api/cms/drafts/:id/restore`；草稿删除接口执行资源级本人/管理员校验。
- 前台新闻和 Wiki 文章页增加“编辑本文”。未登录用户经过带安全回跳参数的登录页，登录后自动打开对应草稿；编辑页保留“返回原文章”路径。
- 后台首页显示统计卡片；文章页支持已发布/已删除/全部筛选，管理员可恢复正式文章；草稿页支持状态筛选、已删除筛选、本人/全部（管理员）范围及删除/恢复。
- 成员管理增加搜索、加载/错误/空状态；个人中心增加草稿和前台成员页入口；主要 CMS 页面补齐加载、错误和空状态提示。

### 新增和修改文件

- 数据库：`server/db/schema.ts`、`server/db/migrations/0009_unique_moira_mactaggert.sql` 及 Drizzle meta。
- 服务与类型：`server/services/cms-deletions.ts`、`server/services/cms-dashboard.ts`、`server/services/cms-articles.ts`、`server/services/cms-drafts.ts`、`server/services/cms-git-worktree.ts`、`server/services/cms-publishing.ts`、`server/services/cms-reviews.ts`、`server/services/cms-edit-locks.ts`、`server/services/cms-media.ts`、`shared/types/cms-articles.ts`、`shared/types/cms-drafts.ts`、`shared/types/cms-dashboard.ts`。
- API：阶段 7 dashboard、文章路径解析、正式文章删除/恢复、草稿删除/恢复路由，以及文章列表/详情和草稿列表筛选参数。
- 前端：`app/components/CmsArticleEditButton.vue`、新闻/Wiki 前台文章页、CMS 登录回跳、文章/草稿/首页/成员/个人中心页面和 CMS/前台样式。
- 测试：阶段 1～6 数据库清理适配新表；新增草稿软删除/恢复、统计、正式文章 Git 删除/恢复和 Push 失败保护回归测试。
- 文档：`docs/ARCHITECTURE.md`、本文件和需求进度清单。

### 依赖与环境

- 没有新增 npm 依赖，也没有新增强制环境变量；继续使用阶段 5 的 Git 工作区配置。
- 集成测试只使用 `TEST_DATABASE_URL` 指向的临时 `vinci_cms_test` PostgreSQL，测试结束后删除临时容器；普通 `DATABASE_URL` 未连接或修改。

### 自动化验证

- 隔离 PostgreSQL 17 临时库：7 个测试文件、33 项全部通过。
- 覆盖草稿本人软删除/恢复、管理员范围查询、删除/恢复审计、正式文章删除/恢复新 Commit、Git Push 失败状态保护和 dashboard 统计。
- `npm run typecheck`：通过。
- `npm run build`：通过；Wiki 检查 226 个文件，Nuxt Content 260 个文件，生产 Nitro node-server 构建并预渲染 540 条路由。
- 构建仍有阶段 0～6 已知的静态图片解析、大 chunk 和 Git bigint target warning，不是阶段 7 引入的构建错误。

### 人工验收前置与步骤

1. 在开发/验收数据库执行 `npm run db:migrate`，应用 `0009_unique_moira_mactaggert.sql`；确认 `.env` 的 `CMS_GIT_WORKTREE` 仍位于部署目录之外。
2. 启动 `npm run dev`，使用普通成员和管理员账号分别登录；打开新闻或 Wiki 正文，点击“编辑本文”。验证未登录回跳、登录后自动打开草稿，以及编辑页“返回原文章”。
3. 在草稿页验证状态筛选；本人删除草稿后在“查看已删除草稿”中恢复。用管理员查看全部草稿，确认可删除/恢复其他成员草稿；检查对应审计日志。
4. 管理员在文章列表切换“已发布/已删除/全部”，删除一篇正式文章，确认 Git 产生删除 Commit、文章进入已删除列表；再恢复并确认产生新的 restore Commit、历史记录仍完整。
5. 使用普通成员账号请求正式文章删除接口，确认服务端返回 403；普通成员只能删除自己的草稿。
6. 查看后台首页统计、成员搜索、个人中心入口，以及主要页面的加载失败和空状态表现。
7. 人工验收通过后，只勾选阶段 7 总体进度，提交后再启动阶段 8。

### 下一阶段注意事项

- 阶段 8 才实现 Docker、Compose、自动部署、备份、恢复和迁移；不要在阶段 7 验收期间提前添加这些内容。
- 正式文章恢复依赖 `article_deletion_events` 中的来源 Commit 与可写 Git 远端；部署目录的 Nuxt Content 展示仍通过后续部署流程更新。
- 不要把普通 `DATABASE_URL` 用于测试清理；所有阶段 7 集成测试继续强制 `TEST_DATABASE_URL`。

## 2026-07-25：阶段 7 人工验收完成

- 维护者已完成人工验收并确认阶段 7 实现符合要求。
- 阶段 7 总体进度已勾选；阶段 8 尚未启动。
- 阶段 7 实现提交为 `7aef3d7`；本次验收记录单独提交，未推送 GitHub。
- 后续如启动新工作，应先明确进入阶段 8；不得在阶段 7 收尾提交中提前加入 Docker、自动部署、备份、恢复或迁移内容。

## 2026-07-26：阶段 8——Docker、自动部署、备份与迁移

### 完成状态

- 阶段 8 的实现、隔离容器演练、脚本检查、CMS 回归、类型检查和生产构建已完成，等待维护者人工验收。
- 需求文档中阶段 8 的任务和验收标准已勾选；总体进度保持未勾选，人工验收通过后再更新。
- 没有开始阶段 9 的安全专项、最终渗透检查或最终验收。
- 启动核对时发现 `main` 和 `origin/main` 实际均为 `925779b`，而不是交接说明中的本地超前 2 个提交；维护者已明确确认按实际同步状态继续。

### Docker 与运行架构

- 新增多阶段 `Dockerfile`：`runtime` 镜像只包含 Nitro 输出、构建时 Markdown、Git/SSH 运行工具；`operations` 镜像包含 migration 与首个管理员命令所需源码和依赖。
- runtime 入口以 root 准备持久 Git volume 和 SSH 文件权限，随后通过 `gosu` 以 `node` 用户运行应用。
- `compose.yaml` 包含 Nuxt 应用、PostgreSQL 17、按需 `migrate` 和 `admin` services；PostgreSQL 仅在 internal network，不向宿主机暴露端口。
- `postgres_data` 与 `cms_git_worktree` 是持久 volumes。正式 Markdown 只使用镜像内构建副本，运行时没有第二份宿主机 Markdown mount。
- PostgreSQL 使用 `pg_isready`；新增 `/api/health` 只执行 `select 1`，应用 Docker healthcheck 使用该接口。
- `.env.example` 增加 Compose、PostgreSQL、镜像、宿主机 Git key/known_hosts、部署校验和备份路径约定，没有真实凭据。

### 部署与 GitHub Actions

- `scripts/deploy.sh` 要求完整 commit SHA、干净部署仓库、匹配的 `origin`，并验证目标属于远端目标分支；应用镜像 tag 必须与 commit 相同。
- 部署依次拉取 runtime/operations 镜像、等待 PostgreSQL、执行 migration、更新应用和检查健康。
- 成功状态写入忽略跟踪的 `.deploy/current`。健康失败时恢复旧镜像和旧 commit；旧镜像不自动 prune。数据库 migration 不自动 down，文档明确要求 expand/contract 向后兼容。
- `.github/workflows/deploy.yml` 在 PR/main push 上使用隔离 PostgreSQL 执行测试、脚本/Compose 检查、类型检查和 production build；构建两个 commit SHA 镜像，main push 后通过 SSH 部署。
- Actions 只从 GitHub Secrets 读取服务器地址、用户、端口、路径、SSH 私钥和固定 known_hosts。数据库、S3、CMS Auth 和 CMS Git 凭据保留在服务器。

### 备份、恢复与防误操作

- `scripts/backup.sh` 校验项目外绝对路径、Compose project/service labels、数据库名和用户，使用 PostgreSQL `pg_dump --format=custom`，并运行 `pg_restore --list` 与 SHA-256 校验。
- 备份包含 PostgreSQL、非敏感 manifest/config checklist；CMS Git 工作区已初始化时还包含全 refs bundle、tracked binary patch、untracked tar、status 和 HEAD。
- 正式 Markdown 明确以 GitHub 为准，图片以 S3 兼容存储为准；普通备份不复制 `.env`、私钥或 S3 图片。
- `scripts/restore.sh` 要求绝对非 symlink 备份目录、checksum/格式校验、Compose/数据库目标校验，以及精确 `RESTORE_CONFIRM=<project>:<database>`。
- restore 只接受完全空的目标库，不执行 drop、clean 或覆盖。Git 异常资料只供隔离人工审查，不自动覆盖正式 CMS Git volume。
- 三个运维脚本共用不可并发的 `.deploy/operation.lock`，异常退出会释放。

### 文档与命令

- 新增 `docs/DEPLOYMENT.md`，覆盖 Linux 前置、首次安装、Docker 初始化、Actions Secrets、回滚、备份、恢复、DNS/HTTPS 和全新服务器迁移。
- `docs/ARCHITECTURE.md` 记录 Docker/部署/备份长期边界；`docs/CMS_SETUP.md` 更新到阶段 8。
- `db:migrate`、`cms:admin`、`cms:content:sync` 改为 `.env` 存在时读取；运维容器中使用 Compose 注入环境，不要求镜像包含 `.env`。
- 新增 `npm run docker:migrate` 与 `npm run docker:admin`。
- 没有数据库 schema 或 migration 变更，没有新增 npm 依赖。

### 自动化验证

- runtime 与 operations 两个 Docker target 构建成功；容器中的 Nuxt production build、Wiki 226 文件检查和 Nitro node-server 构建成功。
- 独立 Compose 项目完成：空库 migration、应用/数据库健康、custom-format backup、非空目标 restore 拒绝、第二个空库 restore、再次 migration 与恢复后应用健康。
- CMS Git 异常备份用临时 volume 和本地未推送测试 commit 验证，bundle 可列出 HEAD/branch，patch 与 untracked archive 均生成。
- 另用一次性 `docker:29-cli` Linux controller、只读源码 mount、独立 Compose project 和独立 volumes 验证全新 Linux 控制环境中的 Compose 解析、PostgreSQL、migration、应用启动与健康。
- 所有演练只使用测试凭据、`.invalid` S3/Git 地址和隔离 Docker volumes；没有连接正常 `DATABASE_URL`、真实 S3、GitHub 发布工作区或生产服务器。演练容器与 volumes 已移除。
- `TEST_DATABASE_URL=postgresql://.../vinci_cms_test`：7 个测试文件、33 项全部通过；普通 `DATABASE_URL` 从测试进程中移除。
- ShellCheck 0.11.0、`bash -n`、Compose config、GitHub Actions YAML 解析、`git diff --check`：通过。
- `npm run typecheck`：通过。
- `npm run build`：通过；保留阶段 1～7 已知的静态图片解析、chunk 和 Git bigint target warning。

### 人工验收前置

1. 只在测试服务器或隔离虚拟机按 `docs/DEPLOYMENT.md` 准备 Docker、`.env`、测试数据库、测试 S3、测试 Deploy Key 和固定 known_hosts。
2. 验证 PostgreSQL/migration/admin/app 健康，再验证阶段 1～7 登录、草稿、审核、发布、历史、图片和删除恢复功能。
3. 运行备份，检查 dump、manifest、config checklist、checksum 和 CMS Git 异常文件。
4. 在另一个空数据库/Compose project 使用精确确认令牌恢复；确认非空库会被拒绝且正常数据未改变。
5. 在测试仓库或 fork 配置测试用 `production` environment Secrets 后，通过其 `main` 和临时测试服务器验证镜像发布、SSH 部署和故障回滚；普通测试分支只验证、不部署，不得直接用真实生产环境做首次演练。
6. 按迁移章节在新测试 Linux 环境恢复数据库，确认 GitHub Markdown 和测试 S3 图片继续有效，并验证 DNS/HTTPS 配置。
7. 人工验收通过后，只勾选阶段 8 总体进度并追加验收记录；阶段 9 必须等待维护者明确启动。

## 2026-07-26：阶段 8 部署方案调整——同仓库内容分流与无中断切换

用户确认 Markdown 继续保留在同一仓库的 `content/`，不拆分仓库；阶段 8 改为按目录自动分流。以下内容覆盖本文件前一节中“单 app 容器替换”和“总是构建两个镜像”的描述。

### 设计结论

- Nuxt Content 3 的 SQLite 索引和 540 条前台路由在构建期生成，不能只替换运行中容器的 Markdown 文件，否则文件、索引和预渲染输出可能不一致。
- 纯 `content/**` commit 仍构建不可变 runtime 镜像，但不构建 operations 镜像、不执行数据库 migration。
- 任何 Vue、TypeScript、配置、依赖、Docker、workflow、migration 或 `content/` 外变化都保守走 `application` 模式，构建 runtime/operations 并执行完整部署；混合 commit 也属于 `application`。
- Compose 现在包含 `app-blue`、`app-green` 与常驻 Caddy `gateway`。候选槽位先通过应用健康检查，Caddy graceful reload 后再通过网关健康检查；原活动槽位保留到下一次发布。
- `gateway_config` volume 保存活动 upstream，网关重启后不回到默认槽位。公网仍只连接宿主机回环端口，两个 Nuxt 槽位不暴露宿主机端口。

### 防误操作

- 新增 `scripts/classify-deployment.sh`，CI 使用完整历史比较起始与目标 commit；空差异、首次 push、workflow dispatch 或非 `content/**` 变化都返回 `application`。
- `scripts/deploy.sh` 不信任 CI 分类：`content` 模式必须已有双槽位状态，并在服务器用 `--no-renames` 再次检查从当前线上 commit 到目标 commit 的全部路径。
- 所有部署要求当前线上 commit 是目标 commit 的祖先，拒绝倒序、分叉和并发乱序发布；镜像 tag 继续必须等于完整目标 SHA。
- 第一次从阶段 8 原单 `app` 容器迁移时必须走 `application`。候选槽位健康后才停止旧容器释放端口；网关失败会尝试重新启动旧容器。该一次性迁移可能有短暂中断。
- 备份脚本按 `.deploy/current` 选择活动槽位读取共享 CMS Git 工作区；备份、恢复和数据库保护边界未放宽。

### 本轮自动化验证

- 合成 Git commit 验证分类：仅 `content/**` 返回 `content`；仅文档或空差异返回 `application`。
- ShellCheck、`bash -n`/`sh -n`、Compose config、GitHub Actions YAML 和 `git diff --check` 均通过。
- 使用仅含测试库的 `TEST_DATABASE_URL`，并从测试进程移除普通 `DATABASE_URL`：CMS 7 个测试文件、33 项全部通过。
- `npm run typecheck` 和 `npm run build` 通过；production build 处理 260 个内容文件并预渲染 540 条路由，保留既有静态图片、chunk 和 bigint target warning。
- 最终源码的 runtime 与 operations Docker targets 均构建成功；最终镜像在隔离 PostgreSQL 17、`.invalid` Git/S3 地址和临时测试凭据下完成 migration、非 root 应用启动、网关健康检查。
- 隔离双槽位演练从 blue 切到 green，停止旧槽位后网站继续健康，gateway 重启后仍指向 green；反向切换期间连续 120 次健康请求为 0 失败。
- 所有测试 Compose 项目的容器、网络和 volumes 已清理；没有连接正常 `DATABASE_URL`、真实 Git、S3、GitHub package 或服务器，没有 push 或外部部署。

### 人工验收

按 `docs/DEPLOYMENT.md` 的教程五、教程六、教程十一和第 13 节清单，在测试仓库/测试服务器验证 `content` 与 `application` 两条流水线、连续请求、模式二次校验和候选失败保护。验收通过前阶段 8 总体进度继续保持未勾选，阶段 9 不得启动。

## 2026-07-26：阶段 8 自动部署调整——内网服务器主动拉取

维护者确认目标服务器位于内网，不希望映射公网 SSH、接入 Tailscale 或在公开仓库的正式服务器上运行 self-hosted Runner。以下设计覆盖本文件此前所有“Actions 通过 SSH 部署”“纯内容不发布 operations 镜像”和“Actions Secrets 保存服务器连接信息”的描述。

### 最新部署链路

- GitHub Actions 继续在隔离 PostgreSQL 中执行脚本检查、CMS tests、类型检查和 production build。
- PR 和非 `main` 只验证；`main` push 验证通过后发布完整 commit SHA 的 runtime 与 operations 镜像，不创建 `latest` 部署依据。
- `scripts/auto-deploy.sh` 由服务器 systemd timer 每分钟触发，主动 fetch `origin/main` 并检查镜像；服务器只需要访问 GitHub/GHCR 的出站 HTTPS。
- 自动部署必须已经存在人工首次部署生成的 `.deploy/current`，且 `.env` 显式设置 `AUTO_DEPLOY_ENABLED=true`；默认示例保持关闭。
- 服务器从当前线上 commit 到最新远端 commit 重新分类累计差异。纯 `content/**` 使用 `content` 并跳过 operations/migration；任何其他累计变化使用 `application`。
- 所有 `main` SHA 都发布 operations 安全备用镜像，是为了服务器离线或错过中间 push 后仍能把最新累计变化安全地按 `application` 部署；纯内容实际部署仍不运行该镜像。

### 网络与凭据边界

- `.github/workflows/deploy.yml` 不再包含 SSH `deploy` job，也不读取 `DEPLOY_HOST`、`DEPLOY_USER`、`DEPLOY_PATH`、SSH 私钥或服务器 host key。
- 数据库、CMS Auth、CMS Git 和 S3 凭据继续只保存在服务器；GHCR 私有 package 的只读登录继续由 `vinci-deploy` 本机 Docker credential 管理。
- 自动部署不开放新的公网端口，不要求公网 IPv4。CMS Git 写入 key 与服务器部署 clone 的公开 HTTPS/独立只读凭据继续分离。

### 防循环与 systemd

- 新增 `systemd/vinci-cms-auto-deploy.service` 和 `.timer` 模板。service 以 `vinci-deploy` 运行，timer 开机两分钟后开始、约每分钟检查一次；仓库模板需要由管理员安装为 `/etc/systemd/system` 的 root-owned 副本。
- 镜像未发布时只记录等待并成功退出，不触碰当前容器。`deploy.sh` 继续负责快进、镜像 tag、累计内容范围、操作锁、migration、候选健康和网关切换。
- 候选真正失败时写 `.deploy/auto-deploy-failed`；同一失败 SHA 不会每分钟重复部署。运维人员排查后可以推送新的向前修复 commit，或明确删除失败标记后重试同一 SHA。
- 备份、恢复、迁移、双槽位和阶段 1～7 的功能边界没有放宽。

### 本轮自动化验证

- 隔离本地 Git 远端与 fake Docker/部署脚本验证：默认关闭、已是最新、镜像未齐等待、纯内容、应用变化、失败 SHA 停止循环、新向前 commit 恢复均通过。
- ShellCheck 0.11.0、`bash -n`/`sh -n`、Compose config、GitHub Actions YAML、systemd unit verify 和 `git diff --check` 均通过。
- 临时 PostgreSQL 17 只向测试进程提供 `TEST_DATABASE_URL`，普通 `DATABASE_URL` 已移除：CMS 7 个测试文件、33 项全部通过。
- `npm run typecheck` 与 `npm run build` 通过；Wiki 226 文件正常，Nuxt Content 处理 260 个文件，保留既有构建 warning。
- runtime 与 operations Docker targets 均构建通过；未推送镜像、未连接真实服务器、正常数据库、真实 S3 或生产 Git 凭据。

### 当前人工验收进度

- 维护者已在服务器完成人工首次 `application` 部署：commit `e8b506eb5cff67fcac13fcb3a92f49746cf5fd39`，活动槽位 `blue`。
- PostgreSQL migration、`app-blue`、gateway 和 `/api/health` 均成功，`.deploy/current` 已写入；首个管理员已创建。
- 尚未验收新的 timer 自动部署、内容/应用两条自动通道、备份恢复和新服务器迁移；阶段 8 总体进度继续保持未勾选，阶段 9 未启动。

## 2026-07-26：阶段 8 自动部署安装简化

维护者确认继续使用宿主机 systemd 主动拉取，但不接受把常规安装拆成大量手工命令。新增 `scripts/install-auto-deploy.sh` 作为唯一推荐入口：

- 无参数执行时，先校验 root、`vinci-deploy`、固定部署目录、`.env` 权限与显式开关、`.deploy/current`、干净 Git working tree、远端身份和 Docker 权限；
- 安装 root-owned service/timer，运行 `systemd-analyze verify`，先试跑一次 service，只有试跑成功才 `enable --now` timer；
- `--status` 统一显示 timer、service 和最近日志；
- `--disable` 只停用未来检查，不停止网站、数据库或已经开始的部署；
- 不自动重写 `.env`，不把 Docker Socket、生产凭据或部署目录挂入新的常驻更新器容器。

`tests/install-auto-deploy.integration.sh` 使用临时 Git working tree、临时 unit 目录和 fake systemd/Docker 命令验证：成功路径会启用 timer，失败试跑不会启用，状态和停用入口可重复使用。Actions 的运维文件检查已包含该测试。

`docs/DEPLOYMENT.md` 教程四现以“一条命令安装并启用”为主流程，逐条 systemd 命令只保留在高级排查。已首次部署但尚无安装器的服务器仍需对包含安装器的 commit 完成一次人工引导部署，这是 timer 无法自动安装自身的唯一过渡步骤。

本轮再次通过 ShellCheck 0.11.0、Shell 语法、Compose config、Actions YAML、systemd unit、两个自动部署隔离测试和 `git diff --check`。临时 PostgreSQL 17 只通过 `TEST_DATABASE_URL` 提供给测试，显式移除 `DATABASE_URL`，CMS 7 个测试文件、33 项通过；临时容器随后删除。类型检查、production build、runtime 与 operations Docker targets 均通过。没有推送 commit 或镜像，没有连接或修改真实服务器、正常数据库、生产 S3 和生产 Git 凭据。

## 2026-07-26：阶段 8 人工验收完成

- 维护者已在 Debian 服务器完成人工首次 `application` 部署，PostgreSQL migration、活动应用槽位、gateway、健康接口和首个管理员均正常。
- 内网服务器主动拉取 timer 已安装并启用；测试 Markdown commit `48580dd2febedddac3e495027e010bf6bfa60535` 被正确识别为 `content`，跳过 operations 与数据库迁移，拉取不可变 runtime 镜像、等待候选健康并完成网关切换。
- 人工备份首次误用 `sudo ./scripts/backup.sh`，root 在 `pg_dump` 后被 Git dubious ownership 拒绝；未生成最终备份目录，异常退出清理保护生效。收尾补充 root 前置拒绝和教程身份说明，正确方式为先 `sudo -iu vinci-deploy` 再运行脚本；不得给 root 添加全局 `safe.directory` 绕过。
- 自动化阶段已经用隔离 Compose project、测试数据库和测试凭据验证 custom-format backup、checksum、非空恢复拒绝、空库 restore、migration、恢复后健康及全新 Linux 控制环境迁移；阶段 9 仍须按其自身要求再次执行最终备份恢复演练。
- 维护者明确要求阶段 8 收尾并进入下一阶段。需求文档中的阶段 8 总体进度已勾选；阶段 9 尚未启动。
- 本次只追加阶段 8 安全收尾和验收记录，未提前实现阶段 9，未推送 GitHub、未操作服务器或外部发布。

## 2026-07-26：阶段 9 安全检查、测试与最终验收实现完成

### 状态与边界

- 启动时确认 `main`、`origin/main` 和 `HEAD` 均包含阶段 8 验收提交 `ac2bc0cd940fee53192751289130f42cf44f5d86`，工作区初始干净。
- 阶段 9 任务及验收子项已完成并在需求文档勾选；总体进度等待维护者按 `docs/PHASE9_SECURITY_AND_ACCEPTANCE.md` 人工验收后再勾选。
- 未 push GitHub、未发布镜像、未触发服务器部署；未连接或清理正常数据库，未使用生产 S3、生产 Git 凭据或生产服务器。
- 维护者明确接受原始 Markdown HTML 的高风险存储型 XSS，以保留高级 HTML/Vue/MDC 能力；本阶段记录明确策略但没有加入 sanitizer。

### 安全实现

- 新增 migration `0010_handy_meteorite.sql` 和 `rate_limit_buckets`：单账号 5 次失败锁定、单来源 30 次登录尝试、单用户 20 次图片上传，默认窗口可配置；429 包含 `Retry-After`。
- 限流键使用 `CMS_AUTH_SECRET` HMAC，不保存原始账号/IP；蓝绿槽位共享 PostgreSQL 状态，并发更新使用 advisory transaction lock，七天旧桶按小时清理。
- 不存在、停用和错误密码账号统一执行 Argon2id 校验；登录、用户和成员写入采用严格输入校验。
- 图片入口增加固定 multipart 字段、55 MB gateway 总请求上限和用户频率限制；原有 Sharp 实际解码、尺寸、草稿权限、编辑租约和 S3 失败补偿保持不变。
- Git/S3/数据库/Auth Token、URL 凭据和私钥在 Git Push、恢复及删除失败落库/响应前统一遮盖；SSH key path 拒绝控制字符并安全 shell quote。
- 修正已有 Git advisory lock BigInt 字面量的 ES2019 构建警告，数值和锁语义不变。

### 验证结果

- 专用 PostgreSQL 17 且仅通过 `TEST_DATABASE_URL`：8 个文件、39 项 CMS 测试全部通过。
- 只提供不可达普通 `DATABASE_URL` 且不提供 `TEST_DATABASE_URL`：数据库测试全部跳过，证明不会误连正常数据库。
- production `.output` HTTP 验证通过 Origin 403、严格输入 400、账号锁定 429、`Retry-After`、成员越权 403、CSRF 退出、管理员 200 和健康 200。
- 自动部署及安装器两个集成脚本、Shell/Caddy/Compose 检查、类型检查和 production build 通过。
- 独立源/目标 Compose projects、数据库、volumes、测试凭据、`.invalid` Git/S3 和仓库外备份路径完成 checksum、空库 restore、向前 migration、数据 marker、应用/gateway 健康与非空二次恢复拒绝；临时资源已清理。
- `npm audit --omit=dev` 当前报告 Nuxt/Nitro 构建归档链 11 high、0 critical；最终 runtime 输出不含被点名的归档/glob 包，未采用审计建议的 Nuxt 降级，已记录为持续监控限制。
