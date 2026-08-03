# CMS 本地运行说明（V2 阶段 10）

## 1. 数据权威

PostgreSQL 是新闻、Wiki、成员、草稿、审核、Revision、Proposal、Outbox 与审计的业务
权威。代码仓库不再包含三类正式 Markdown，也不使用 Nuxt Content。独立内容仓库只由导出、
对账、受控恢复和 PR 导入使用；普通开发服务器与 production build 不读取它。

## 2. 环境

复制 `.env.example` 为本机 `.env`，至少设置名称明确的本地/隔离 PostgreSQL、32 字符以上
`CMS_AUTH_SECRET`、站点 Origin 和测试 S3/COS。生产必须使用 HTTPS 与 secure cookie；
密钥不得提交到 Git。

```bash
npm ci
npm run db:migrate
npm run cms:admin
npm run dev
```

`cms:admin` 只用于空环境创建首个管理员。日常账号、成员、文章和图片都通过 CMS 维护。
不要运行历史 `cms:content:sync` 把代码仓库目录当作初始数据；新环境应恢复 PostgreSQL dump，
只有灾难恢复才按 `docs/v2/BACKUP_AND_RECOVERY.md` 从独立 snapshot 初始化空库。

## 3. 内容工作流

- 新文章和编辑草稿只写 PostgreSQL；编辑锁与乐观版本号阻止并发覆盖。
- 提交、审核、发布分离；发布创建不可变 Revision、更新当前指针并写 export Outbox。
- 前台立即从数据库读取；异步 Worker 确定性导出独立内容仓库，失败可重试。
- 成员资料数据库权威，账号绑定/角色/密码不能通过 Markdown PR 修改。
- 图片经服务端 Sharp 校验并转 WebP 后进入 S3/COS，浏览器拿不到对象存储密钥。
- CMS 最终预览和正式前台共用 `VinciMarkdownRenderer`/Comark。
- 富文本单栏、源码双栏滚动同步、移动切换和登记内容组件的使用及扩展方法见
  `docs/CMS_EDITOR_GUIDE.md`。

外部内容导入只读取配置仓库的 PR API：安全文章变更创建草稿，成员变更创建 Proposal，
删除/移动走后续审核。评论和关闭 PR 均需独立授权；不会 Merge、批准或发布。

## 4. 本地验证

数据库集成测试必须使用名称包含 `test`、且与应用数据库不同的 `TEST_DATABASE_URL`：

```bash
TEST_DATABASE_URL=postgresql://.../vinci_cms_test npm run test:cms
TEST_DATABASE_URL=postgresql://.../vinci_cms_test npm run test:v2:phase10
npm run typecheck
npm run build
```

需要对全部既有 Markdown 做兼容或完整性检查时，显式传入独立内容仓库 snapshot；这个变量
不能用于普通 build：

```bash
V2_CONTENT_SNAPSHOT_SOURCE=/绝对/snapshot npm run test:v2:phase3
WIKI_CHECK_SOURCE=/绝对/snapshot npm run wiki:check
```

完整部署、备份、恢复和回滚见 `docs/DEPLOYMENT.md` 与
`docs/v2/BACKUP_AND_RECOVERY.md`。
