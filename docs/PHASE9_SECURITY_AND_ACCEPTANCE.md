# 阶段 9 安全、运维与最终验收

## 1. 当前状态

阶段 9 的实现和自动化验证已经完成，等待维护者按本文人工验收。需求文档中的阶段 9 总体进度在人工确认前必须保持未勾选。

本阶段没有连接或清理正常数据库，没有使用生产 S3、生产 Git 写入凭据或生产服务器，也没有 push、发布镜像或触发真实部署。

## 2. 安全基线

### 2.1 登录、会话与 CSRF

- 登录和所有写 API 都要求浏览器 `Origin` 与请求自身 Origin 或 `NUXT_PUBLIC_SITE_URL` 的完整 Origin 一致。
- `NUXT_PUBLIC_SITE_URL` 必须包含协议、主机和端口，不带路径。`localhost` 与 `127.0.0.1` 是不同来源；修改后必须重启应用。
- 会话 Cookie 使用 `HttpOnly`、`SameSite=Lax`；生产环境必须设置 `CMS_SECURE_COOKIES=true`。
- CSRF Token 使用 `CMS_AUTH_SECRET` HMAC 并与当前会话绑定；退出、草稿、审核、发布、上传和管理操作均在服务端重新鉴权及校验 CSRF。
- 不存在、停用和密码错误的账号都执行 Argon2id 校验并返回相同的“账号或密码错误”，减少账号枚举信息。

### 2.2 登录失败保护与速率限制

限流状态持久化在 PostgreSQL 的 `rate_limit_buckets`，蓝绿槽位共享同一状态；并发更新使用 PostgreSQL advisory transaction lock。键只保存使用 `CMS_AUTH_SECRET` 生成的 HMAC，不保存原始账号或 IP。

默认值：

| 范围 | 默认限制 | 结果 |
| --- | --- | --- |
| 单账号登录失败 | 15 分钟内 5 次 | 第 5 次起锁定 15 分钟 |
| 单来源登录尝试 | 5 分钟内 30 次 | 第 31 次起返回 429 |
| 单用户图片上传 | 1 分钟内 20 次 | 第 21 次起返回 429 |

429 响应包含 `Retry-After`、`RATE_LIMITED` 和剩余秒数。成功登录会清除该账号失败记录；七天前的桶由登录流量按小时触发清理。

可通过 `.env` 调整：

```dotenv
CMS_LOGIN_FAILURE_LIMIT=5
CMS_LOGIN_FAILURE_WINDOW_MINUTES=15
CMS_LOGIN_LOCKOUT_MINUTES=15
CMS_LOGIN_IP_ATTEMPT_LIMIT=30
CMS_LOGIN_IP_WINDOW_MINUTES=5
CMS_MEDIA_UPLOAD_LIMIT=20
CMS_MEDIA_UPLOAD_WINDOW_MINUTES=1
```

应用容器不能绕过 gateway 对公网开放，否则客户端可能伪造转发 IP，削弱来源限流。

### 2.3 权限、路径与输入

- 未登录用户只能访问登录和公开文章解析接口。
- 普通成员只能操作自己有权访问的草稿、锁和资料；管理员权限在每个管理、审核、发布、历史恢复及正式删除接口中由服务端校验。
- 动态资源使用 UUID 查询；Markdown 文件路径在真实路径解析后必须仍位于允许的 collection 根目录，拒绝绝对路径和 `..`。
- JSON 写接口使用 Zod 校验；登录、用户和成员写入拒绝未知字段。成员头像只接受安全站内路径或无内嵌凭据的 HTTP(S) URL，元数据上限为 100 KB。
- 业务状态冲突通过统一的 CMS workflow 错误映射返回；限流统一返回 429；未知服务端错误不向客户端返回凭据。

### 2.4 图片上传

- 必须登录、通过 CSRF、拥有草稿权限和有效编辑租约。
- 每次只接受一张图片及固定 multipart 字段，拒绝未知或重复字段。
- gateway 请求体硬上限为 55 MB；服务端配置最大原图不超过 50 MiB，默认 10 MiB，并在声明长度和实际解码后分别检查。
- 不信任扩展名或浏览器 MIME，以 Sharp 实际解码结果为准；仅接受 JPEG、PNG、WebP、GIF，统一转为 WebP。
- 对象 key 由系统生成，不使用客户端文件名；上传后数据库或锁校验失败会尽力删除新对象。
- 测试使用内存 S3 替身和 `.invalid` 地址，不接触生产 Bucket。

### 2.5 日志与失败信息

Git Push、历史恢复和正式删除失败写入数据库或返回客户端前，会遮盖：

- `DATABASE_URL`、数据库密码和 CMS Auth Secret；
- S3 Access Key/Secret Key；
- Git remote URL 中的凭据、GitHub Token 和 Authorization Header；
- SSH/其他私钥正文。

备份的 config checklist 只记录配置是否存在，不记录值。发现疑似泄露时，应先停用对应凭据，再按 `docs/DEPLOYMENT.md` 轮换，不要通过删除 Git 历史掩盖事故。

## 3. Markdown HTML 安全策略

维护者明确要求保留 Markdown 中的高级原始 HTML、Vue/MDC 和扩展语法，因此本项目有意不启用 HTML sanitizer，也不移除现有 HTML。

这是一个已接受的高风险存储型 XSS 边界：能够让恶意 HTML 通过审核并发布的人，可能在前台访问者浏览器中执行脚本或注入内容。当前控制措施是 CMS 登录、草稿审核、仅管理员发布、Git 可审计历史和恢复流程；这些措施不能把恶意 HTML 变成安全 HTML。

运维要求：

- CMS 账号只授予可信编辑者，管理员数量保持最少；
- 管理员发布前必须审查原始 Markdown/HTML，而不只看视觉预览；
- 不得把未经信任的外部 Markdown 自动导入并直接发布；
- 若未来要面向不可信作者开放自动发布，必须重新设计 HTML allowlist/sandbox；这会改变当前内容兼容性，需要独立评审和迁移方案。

## 4. 自动化验证结果

2026-07-26 本地阶段 9 验证结果：

- 启动基线：`main`、`origin/main` 和 `HEAD` 均包含阶段 8 验收提交 `ac2bc0cd940fee53192751289130f42cf44f5d86`，工作区初始干净。
- CMS 测试：专用 PostgreSQL 17、只提供 `TEST_DATABASE_URL`，8 个文件、39 项全部通过。
- 防误连接测试：只提供一个指向不可达端口的普通 `DATABASE_URL`、不提供 `TEST_DATABASE_URL` 时，数据库测试全部跳过；测试入口不会使用普通数据库变量。
- 生产包 HTTP 测试：缺失/错误 Origin 为 403，未知 JSON 字段为 400，第 5 次账号失败为 429 且带 `Retry-After`，普通成员访问管理员 API 为 403，错误 CSRF 退出为 403，正确退出成功，管理员访问为 200，健康接口为 200。
- 自动部署脚本回归：`auto-deploy.integration.sh` 与 `install-auto-deploy.integration.sh` 通过。
- Shell 语法、Caddy 配置、Compose 配置和 `git diff --check` 通过。
- `npm run typecheck` 通过。
- `npm run build` 通过；Wiki 226 个文件及站内链接检查通过。
- 隔离恢复演练：两个独立 Compose project、两个独立 PostgreSQL volumes、两个带 `test` 的数据库、测试凭据、`.invalid` Git/S3、仓库外项目目录和仓库外备份路径。checksum、空库恢复、向前 migration、审计标记、应用/gateway 健康、非空二次恢复拒绝全部通过，临时资源已清理。
- 没有 push GitHub、发布镜像或操作生产服务器。

## 5. 已知限制

1. 原始 Markdown HTML 的存储型 XSS 风险由维护者明确接受，详见第 3 节。
2. `npm audit --omit=dev` 报告 Nuxt/Nitro 构建归档依赖链的 11 个 high、0 个 critical；审计建议降级 Nuxt，当前未采用。最终 runtime `.output` 不包含被点名的 `archiver`、`brace-expansion`、`minimatch` 或 `readdir-glob`；operations 镜像只应按需执行受信任的 migration/admin 命令，不得对公网提供服务。每次依赖升级继续复查 [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg) 及 Nuxt 官方更新。
3. 账号级锁定可被用于暂时锁定已知账号；来源限流降低单一来源滥用，但不能替代网关/WAF、监控和账号告警。
4. 图片二进制仍以 S3 兼容存储为权威，PostgreSQL 备份不包含图片；必须单独启用对象存储版本控制、复制或供应商备份。
5. 第一期没有媒体库、自动删除孤立对象、审计后台查询或自动备份保留清理；这些不应在阶段 9 临时扩展。

## 6. 阶段 9 人工验收步骤

所有有破坏性的步骤只在测试服务器、测试 Git 仓库/fork、测试 S3 和隔离测试数据库执行。

### 6.1 准备

1. 确认部署 commit 是阶段 9 commit，保留阶段 8 的 gateway、双槽位、timer 和两条部署通道。
2. 使用独立 Compose project、独立 volumes 和测试凭据；确认 `docker compose config --quiet` 通过。
3. 把 `NUXT_PUBLIC_SITE_URL` 设置为浏览器实际访问的完整测试 Origin，重启应用。
4. 运行 migration `0010_handy_meteorite.sql`，创建一个测试管理员和至少两个普通成员。

### 6.2 登录、退出和权限

1. 未登录访问 `/cms` 和受保护 API，应跳转登录或返回 401；公开前台文章仍可读。
2. 用错误 Origin 登录应显示“请求来源不受信任”；正确 Origin 可登录。
3. 连续输错同一测试账号 5 次，第 5 次应返回 429；响应包含 `Retry-After`。不要用生产账号演练。
4. 登录后刷新仍保持会话；退出后原 Cookie 访问 session API 返回 401。
5. 用缺失/错误 CSRF Token 调用退出或写 API，应返回 403。
6. 普通成员访问用户管理、审核、正式发布、历史恢复和正式删除 API，均应返回 403。
7. 管理员可进入审核和管理接口，但不能绕过草稿状态、编辑锁或版本冲突。

### 6.3 草稿、审核、锁与冲突

1. 普通成员新建草稿，编辑标题、作者和正文，等待自动保存后刷新，内容与版本号应保留。
2. 同一成员用旧版本号再次保存，应收到版本冲突而不是覆盖新内容。
3. 成员 A 持有编辑锁时，成员 B 打开同一正式文章的草稿应只读；锁过期后可重新获取。
4. 管理员填写原因接管锁，成员 A 后续保存应失败，审计日志包含接管事件。
5. 提交审核后草稿不可编辑；测试撤回、驳回、继续编辑、重新提交和批准。
6. 在测试 Git 直接修改正式 Markdown 后再提交/批准旧基线草稿，应触发内容冲突，不能自动覆盖。

### 6.4 发布、失败与恢复

1. 在测试 Git/S3 环境批准并发布 Markdown，确认 commit、push、数据库状态和前台页面一致。
2. 发布一段经人工确认的高级 HTML/MDC，确认当前兼容策略仍保留；同时确认团队接受第 3 节风险。
3. 使用测试远端拒绝 push，确认草稿保持 `approved`、失败记录已遮盖凭据，修复测试远端后可重试。
4. 查看历史版本和差异；管理员恢复旧版本应创建新 commit，不删除历史。

### 6.5 图片与恶意输入

1. 上传有效 JPEG、PNG、WebP、静态/动态 GIF，确认实际内容被识别并转为 WebP。
2. 测试错误扩展名、伪造 MIME、损坏图片、超限图片、未知/重复 multipart 字段，均应拒绝且不留下对象记录。
3. 无编辑锁、错误草稿、越权草稿和错误 CSRF 上传均应失败。
4. 在测试账号一分钟上传 20 次后，第 21 次应返回 429；只使用测试 S3 或内存替身。
5. 对文章路径提交绝对路径、`../`、反斜杠穿越和非法 commit，均应返回 400/404，且项目外文件不变。

### 6.6 日志、构建和恢复

1. 在完全虚假的测试错误中加入密码、数据库 URL、GitHub Token、私钥和 S3 key；检查 API、数据库失败原因、应用日志均没有明文。
2. 执行 `npm run test:cms`、`npm run typecheck`、`npm run build` 和两个自动部署脚本测试。
3. 按 `docs/DEPLOYMENT.md` 教程九或运行 `npm run test:backup-restore` 完成隔离恢复；确认非空目标拒绝、恢复后 marker/业务数据与 `/api/health` 正常。
4. 确认正常 Compose project、正常数据库 volume、生产 S3/Git 和服务器从未被测试命令引用。

全部人工步骤通过后，维护者明确回复验收结果；届时才勾选需求文档“总体进度”中的阶段 9。
