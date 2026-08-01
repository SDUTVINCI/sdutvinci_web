# Vinci 网站与 CMS 架构

## 1. 当前权威边界

本文记录 V2 阶段 10 后的现行架构。阶段 0～9 的迁移过程、旧 Git-first 路径和首次复制
历史只用于审计与回滚，不是生产操作说明；详见 `docs/v2/PHASE_V2_*_ACCEPTANCE.md`。

- PostgreSQL 是新闻、Wiki、成员公开资料及其当前版本的线上唯一权威。
- `article_revisions`、`member_revisions` 保存不可变正式版本；发布事务更新当前指针并写审计。
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
标题 ID 和目录逻辑。公开页面不调用 `queryCollection` 或 `ContentRenderer`。Wiki 公共路径、
目录和顺序由普通应用模块从数据库字段派生；发布、恢复和导出使用同一算法。

## 3. 运行与部署

技术栈为 Nuxt 4.5、Vue 3.5、Nitro node-server、TypeScript、PostgreSQL/Drizzle、Comark、
CodeMirror/Milkdown、S3 兼容对象存储和 Docker Compose。

- `runtime` 镜像只含 Nitro 输出和运行依赖，以非 root 用户运行；不含 Git/SSH、代码仓库
  正式 Markdown 或内容 workspace。
- `operations` 镜像提供 migration、管理员 CLI、备份、对账和受控恢复能力；Git/SSH 只在
  必需的运维容器中存在。
- Compose 持久化 `postgres_data` 与 `gateway_config`。内容导出使用独立、受标记保护的
  workspace，不挂入前台应用。
- `app-blue`、`app-green` 和常驻 `gateway` 保持不变。候选槽位健康后，gateway graceful
  reload 切换；每分钟主动检查机制保持不变。
- 代码仓库的每个可部署变更都分类为 `application`，构建 runtime 和 operations 镜像，先
  运行向前 migration，再走蓝绿发布。不存在“纯 `content/**` 镜像部署”。
- CMS 发布只提交数据库事务并写 export Outbox；内容 Worker/凌晨对账更新独立内容仓库，
  不触发代码 Actions 或 runtime 镜像构建。

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
   修改反向覆盖。

文章 PR 导入固定比较 Base snapshot、数据库 Current Revision 与 PR Proposed。安全修改只建
草稿；成员修改只建 Proposal；移动/删除需后续审核；评论与关闭 PR 需明确授权且没有 Merge
API。页面的白话说明、中文状态和 Git diff 行级材料属于长期回归边界。

## 5. 安全边界

- 服务端会话令牌只以 SHA-256 摘要入库；密码用 Argon2id；写 API 校验同源、CSRF 和角色。
- 浏览器拿不到数据库、Git、GitHub、S3 密钥。错误、审计与报告不得记录 Token、Cookie、
  私钥、带凭据 URL 或未脱敏 stderr。
- Markdown 渲染阻断脚本、事件属性和危险协议；未知模板 token 以文本保留，不能静默丢失。
- 内容路径拒绝绝对路径、`..`、反斜线、NUL、symlink、特殊文件和受控根越界。
- 恢复只允许名称带 `test` 的隔离空数据库完成演练；生产恢复需要绑定项目和数据库的精确
  确认令牌。

## 6. 备份与恢复

- 正常恢复以 PostgreSQL custom-format dump 为准，校验 SHA 和 dump 清单后恢复到空库，
  再运行向前 migration、pointer/hash 完整性与 HTTP 检查。
- 独立内容仓库的 `news/`、`wiki/`、`members/`、`.vinci/snapshot.json` 和 `manifest.json`
  必须共同备份。只有完整数据库备份不可用时，才使用 operations 的受控内容恢复入口。
- 内容快照能恢复公开内容和当前 Revision，不能恢复用户、会话、全部历史 Revision、完整
  审核/审计；因此不能代替数据库备份。
- S3/COS 二进制、真实 `.env`、SSH 私钥和 Token 由各自备份机制保护。

具体命令、保留策略和故障取证见 `docs/v2/BACKUP_AND_RECOVERY.md`。

## 7. 目录职责

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
