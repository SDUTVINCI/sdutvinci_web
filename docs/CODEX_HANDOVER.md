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
