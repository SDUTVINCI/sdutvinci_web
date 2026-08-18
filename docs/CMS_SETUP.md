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
- 图片对象按 `<prefix>/<collection>/<文章创建年>/<月>/<日>/<Unix毫秒>-<内容哈希前8位>.webp`
  命名；已有文章优先取文章路径日期，尚无路径时取 `publishedAt`，再回退草稿创建日。仓库静态媒体使用独立
  `site-assets/`，详见 `docs/STATIC_MEDIA_MIGRATION.md`。
- CMS 最终预览和正式前台共用 `VinciMarkdownRenderer`/Comark。
- 富文本单栏、源码双栏滚动同步、移动切换和登记内容组件的使用及扩展方法见
  `docs/CMS_EDITOR_GUIDE.md`。

外部内容导入只读取配置仓库的 PR API：安全文章变更创建草稿，成员变更创建 Proposal，
删除/移动走后续审核。评论和关闭 PR 均需独立授权且成功后不可重复触发；管理员可在关闭后用
独立清理凭据删除同仓库源分支。不会 Merge、批准或发布，外部 Fork 分支不会由 CMS 删除。

## 4. 本地验证

需要一次性准备完整内容、测试管理员和浏览器页面时，使用
`docs/CMS_LOCAL_TEST_ENVIRONMENT.md` 的隔离一键脚本。

CMS 登录后的顶部工具栏提供“深色模式 / 浅色模式”按钮。选择会立即应用到 CMS 和同一标签页
中的官网页面，并以 `vinci-theme` 保存在浏览器本地；刷新或重新打开后继续使用该选择。首次访问
且没有已保存选择时沿用操作系统配色偏好。按钮不需要管理员权限，不调用 API，也不把主题偏好
写入 PostgreSQL。浏览器禁用本地存储时当前页面仍可切换，但刷新后会回到系统偏好。

主题切换只改变显示配色，不改变文章预览内容、编辑权限、草稿数据、Revision 或发布流程；
本功能不提供按账号跨设备同步和额外主题。数据库 Schema 无变化，因此不需要 Migration。
完整的使用、异常行为、非目标和回滚说明见 `docs/CMS_THEME_GUIDE.md`。

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
