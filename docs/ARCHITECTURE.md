# Vinci 网站与 CMS 架构

## 1. 当前权威边界

本文记录 V2 阶段 11 实现后的现行架构。阶段 0～10 的迁移过程、旧 Git-first 路径和首次复制
历史只用于审计与回滚，不是生产操作说明；详见 `docs/v2/PHASE_V2_*_ACCEPTANCE.md`。

- PostgreSQL 是新闻、Wiki、成员公开资料及其当前版本的线上唯一权威。
- `article_revisions`、`member_revisions` 保存不可变正式版本；发布事务更新当前指针并写审计。
- `article_credit_identities` 保存文章署名稳定 ID 到网页显示姓名的投影；Markdown 的
  `authors`/`contributors` 继续只保存拼音 ID，不因显示名调整而改写正式正文。
- 独立内容仓库是数据库确定性导出的可读快照，也是 PostgreSQL 完整备份不可用时的受控
  灾难恢复材料。它不是代码镜像输入，也不是绕过审核的发布入口。
- S3/COS 是图片二进制权威；数据库和 Markdown 只保存受控 URL 与元数据。
- 代码仓库不承载 `content/news`、`content/wiki`、`content/members`，不依赖 Nuxt Content、
  SQLite 内容索引或构建期正式 Markdown。

## 2. 请求与数据流

```text
浏览器
  ├─ 新闻 / Wiki / 团队 / 搜索 / Sitemap / RSS
  │    └─ Nitro API / server service
  │         └─ PostgreSQL 当前 Revision / Member Revision
  └─ /cms
       └─ 鉴权、草稿、审核、发布、PR 提案
            ├─ PostgreSQL（事务权威、审计、Outbox、Proposal）
            ├─ S3/COS（图片）
            └─ 异步导出 Worker
                 └─ 独立内容仓库 main（news/wiki/members + snapshot/manifest）
```

正式前台和 CMS 最终预览共用 `VinciMarkdownRenderer` 与同一套 Comark 插件、安全策略、
标题 ID、Wiki 标题编号和目录逻辑。公开页面不调用 `queryCollection` 或 `ContentRenderer`。Wiki 公共路径、
目录和顺序由普通应用模块从数据库字段派生；发布、恢复和导出使用同一算法。

文章访问权限由 `articles.requires_auth` 保存，默认 `false`（未登录可见）。匿名新闻/Wiki 列表、
详情、搜索、Sitemap 和 RSS 统一排除需登录文章；有效 CMS 会话可读取。权限是文章投影层策略，
不进入 Frontmatter、Revision 或 Markdown 导出，也不改变 PostgreSQL 的内容权威边界。管理员在
CMS 文章列表中按筛选结果逐篇或批量调整，写接口继续要求管理员角色、同源和 CSRF。

文章编辑器有两个显式模式：富文本使用 Milkdown/Crepe 单栏画布；源码在桌面端同时显示
CodeMirror 和正式渲染预览，移动端在保持两个面板状态的前提下切换。源码与预览由最近主动
滚动的一侧按文档进度双向驱动；程序滚动事件会被抑制，正文更新后按原进度恢复，避免循环和
回顶。网站内容组件由共享注册表、富文本插入入口、
`VinciMarkdownRenderer` Vue 组件映射和正式 CSS 共同登记。

## 3. 运行与部署

技术栈为 Nuxt 4.5、Vue 3.5、Nitro node-server、TypeScript、PostgreSQL/Drizzle、Comark、
CodeMirror/Milkdown、S3 兼容对象存储和 Docker Compose。

- `runtime` 镜像只含 Nitro 输出和运行依赖，以非 root 用户运行；不含 Git/SSH、代码仓库
  正式 Markdown 或内容 workspace。
- `operations` 镜像提供 migration、管理员 CLI、备份、对账和受控恢复能力；Git/SSH 只在
  必需的运维容器中存在。
- Compose 持久化 `postgres_data` 与 `gateway_config`。内容导出使用独立、受标记保护的
  workspace，不挂入前台应用。
- PostgreSQL、migration、管理员和本地恢复只连接 `internal: true` 的 `backend` 网络；doctor、
  内容导出 Worker 和对账同时连接专用非入站 `egress` 网络访问 COS/GitHub。不能为解决出站访问
  而取消数据库 backend 的 internal 隔离，也不把高权限运维容器接入前台网络。
- `app-blue`、`app-green` 和常驻 `gateway` 保持不变。候选槽位健康后，gateway graceful
  reload 切换；每分钟主动检查机制保持不变。
- 代码仓库的每个可部署变更都分类为 `application`，构建 runtime 和 operations 镜像，先
  运行向前 migration，再走蓝绿发布。不存在“纯 `content/**` 镜像部署”。
- CMS 发布只提交数据库事务并写 export Outbox；内容 Worker/凌晨对账更新独立内容仓库，
  不触发代码 Actions 或 runtime 镜像构建。
- `./vinci` 是安装、更新、状态、doctor、管理员创建、备份/校验/清理、恢复和实例迁移的统一维护入口；
  底层安全脚本保留给编排与高级排障。
- 首次安装拒绝 `local`/`latest` 镜像标签并要求完整 SHA 与 Git HEAD 一致；安装后的运维容器从
  `.deploy/current` 选择活动 SHA，避免蓝绿更新后继续运行旧 operations 镜像。
- 部署和 timer 默认使用执行首次安装的当前系统用户。用户名、UID、GID、Home 和 Shell 从 NSS
  解析，只写本机安装清单；迁移到不同用户的新服务器时重新生成 unit。
- 动态 systemd 覆盖自动部署、02:00 备份、03:00 对账、04:00 清理和每小时 doctor；日志按
  日/30 份/100 MiB 轮转，迁移包与密钥分开传输并按 30 日策略清理。
- 首次 V2 空库若要保留独立内容仓库的正式内容，必须通过显式 snapshot、逐文件哈希和精确令牌
  建立数据库基线；数据库为空不等于内容仓库为空。`empty` 只用于真正的空内容新站点，正式安装
  省略初始化模式会 fail closed。

生产 schema 使用 expand/contract，migration 不自动 down。服务器只出站拉取 Git 和镜像；
候选失败保留当前版本，禁止 reset、force push 或覆盖非空数据库。

## 4. CMS 写入模型

1. 用户在数据库草稿中编辑 Markdown，Frontmatter 与正文分离管理。
2. 编辑锁、乐观版本号、实时 Current Revision 检查防止静默覆盖。
3. 提交、审核与发布是独立动作；发布前再次校验审核者、基线和权限。
4. 发布在一个事务中创建不可变 Revision、更新 Article/Member 指针、写审计与 export
   Outbox；失败全部回滚。
5. 异步 Worker 确定性序列化，向独立内容仓库创建普通快进 Commit；失败不回滚数据库正式
   发布，保留可重试 Outbox 和脱敏错误。
6. 每日全量对账从数据库投影完整快照，修正独立内容仓库受管路径；数据库永不被仓库普通
   修改反向覆盖。数据库内容为 0 而仓库非空时触发空库保护，在任何文件删除、Commit 或 Push
   之前失败，要求先完成显式首次 snapshot 导入。

文章 PR 导入固定比较 Base snapshot、数据库 Current Revision 与 PR Proposed。安全修改只建
草稿；成员修改只建 Proposal；移动/删除需后续审核；评论与关闭 PR 需明确授权且没有 Merge
API。页面的白话说明、中文状态和 Git diff 行级材料属于长期回归边界。

## 5. 安全边界

- 服务端会话令牌只以 SHA-256 摘要入库；密码用 Argon2id；写 API 校验同源、CSRF 和角色。
- 浏览器拿不到数据库、Git、GitHub、S3 密钥。错误、审计与报告不得记录 Token、Cookie、
  私钥、带凭据 URL 或未脱敏 stderr。
- Markdown 渲染阻断 `script`、事件属性、`srcdoc` 和可执行 URL；普通 HTML、HTTPS iframe、
  Vue/MDC 与登记组件允许渲染。处理只改变渲染树，不回写正文；未知语法和模板 token 必须保留。
- 内容路径拒绝绝对路径、`..`、反斜线、NUL、symlink、特殊文件和受控根越界。
- 恢复只允许名称带 `test` 的隔离空数据库完成演练；生产恢复需要绑定项目和数据库的精确
  确认令牌。

## 6. 备份与恢复

- 正常恢复以 PostgreSQL custom-format dump 为准，校验 SHA 和 dump 清单后恢复到空库，
  再运行向前 migration、pointer/hash 完整性与 HTTP 检查。
- 独立内容仓库的 `news/`、`wiki/`、`members/`、`.vinci/snapshot.json` 和 `manifest.json`
  必须共同备份。它可用于从独立内容仓库建立首次 V2 数据库基线；已运行 V2 的灾难恢复仍应优先
  使用完整 PostgreSQL 备份，只有完整备份不可用时才退回受控内容恢复入口。
- 内容快照能恢复公开内容和当前 Revision，不能恢复用户、会话、全部历史 Revision、完整
  审核/审计；因此不能代替数据库备份。
- S3/COS 二进制、真实 `.env`、SSH 私钥和 Token 由各自备份机制保护。

具体命令、保留策略和故障取证见 `docs/v2/BACKUP_AND_RECOVERY.md`。

## 7. 最终运维拓扑

```text
当前安装用户 ./vinci
  ├─ install/update ─→ 完整 SHA 镜像 ─→ migration ─→ blue/green ─→ gateway
  ├─ backup/restore ─→ custom dump + SHA ─→ 仅空库 ─→ migration/health
  ├─ export/import-instance ─→ 无密钥迁移包 ─→ 新服务器重新生成 unit
  ├─ doctor ─→ PostgreSQL + 内容任务 + S3/COS + 容器/槽位/timer
  └─ timers：每分钟更新；02:00 备份；03:00 对账；04:00 清理；每小时健康
```

## 8. 目录职责

```text
app/                         前台与 CMS Vue 页面
server/api/                  公开和 CMS HTTP API
server/services/             权威查询、审核、发布、导出、恢复
server/db/                   Drizzle schema 与向前 migration
shared/utils/                浏览器/Nitro 共用的纯模块
scripts/                     部署、备份、对账、恢复与完整性检查
docs/v2/                     需求、阶段验收与运行手册
```

代码仓库内若测试需要 Markdown，必须使用具名临时夹具；全量内容检查必须显式传入独立内容
仓库 snapshot 根。任何普通 build、runtime 启动或 application 部署都不得读取该 snapshot。

## 9. 成员申请与 Wiki PDF（2026-08）

成员年级/赛季/组别选项由 PostgreSQL `member_cohorts` 管理；公开申请进入
`member_applications`，审核通过后才复用正式成员 Revision/Outbox 事务。临时头像由 S3/COS
承载并带 24 小时过期清理边界。Wiki PDF 是登录保护的按需 Pandoc 导出，不成为新的内容权威。
完整操作与验收见 `docs/MEMBER_APPLICATION_AND_WIKI_PDF.md`。

## 10. 文章署名身份（2026-08）

Wiki 署名解析按“同 ID 的有效正式成员 → 署名身份登记 → 原 ID 回退”的顺序执行。独立署名
只显示维护的姓名；关联正式成员后复用成员姓名、头像和主页。管理员在 CMS“成员管理”的
“文章署名身份”区登记、搜索和修改，稳定 ID 创建后不可改名，避免历史 Markdown 引用失效。

署名身份是 PostgreSQL 权威数据的一部分。新增或修改会写审计并合并排队一次全量内容对账；
`.vinci/snapshot.json` 包含 `creditIdentities`，空库初始化和灾难恢复会一并校验和恢复。旧的
version 1 快照没有该字段时按空数组读取，保持向后兼容。

## 11. 成员账号注册审核（2026-08）

未登录成员可在 `/cms/login` 从已上线正式成员中认领本人资料并提交账号注册申请；没有成员资料时先去
`/team/apply`。稳定账号 ID 由服务端按成员 ID 及最小数字后缀确定，浏览器只读展示。申请不会直接
创建账号，管理员在 CMS“账号管理”审核通过后，事务内创建普通 `member` 用户并写入唯一成员绑定。

`account_registration_applications` 仅在 pending 阶段保存 Argon2id 密码哈希，通过或拒绝后清除；
`user_members` 继续保证一名成员只能绑定一个账号。同源、IP 限流、管理员角色、CSRF 和审计边界保持
不变。具体流程与测试见 `docs/ACCOUNT_REGISTRATION.md`。

## 12. Footer 组织与合作信息（2026-08）

公开站 Footer 的机构 Logo 墙由 `app/data/footer-partners.ts` 集中维护，分为“组织与平台”和
“赛事与合作支持”，避免将所属高校、所属社团、实践平台或核心赛事误标为赞助商。
每项同时展示 Logo、中文名称和身份，整项跳转对应官方页面。Logo 使用
`cdn.sdutvincirobot.top/site-assets/images/sponsors/` 下的透明 WebP，并直接叠放在 Footer 背景上；
布局与浅深色适配仍由代码仓库管理。
