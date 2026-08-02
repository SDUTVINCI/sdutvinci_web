# V2 阶段 10：剔除 Nuxt Content 和代码仓库内容目录——实施与验收

日期：2026-08-02
状态：维护者人工验收通过，阶段 10 正式收尾
基线：`08a1c4908c8890dad5284e9682304e1ac0c7550e`

## 1. 当前状态与边界

- 本阶段只移除 Nuxt Content、代码仓库正式内容目录和纯内容镜像发布分类；未进入阶段 11。
- PostgreSQL 固定为新闻、Wiki、成员及发布 Revision 的运行时权威。
- 独立内容仓库继续保存 `news/`、`wiki/`、`members/`、snapshot、manifest 和 Git 历史。
- CMS 草稿、审核、发布、成员 Proposal、Outbox、凌晨对账、恢复与 PR 导入安全边界保持不变。
- 阶段 8/9 PR 页面白话说明、中文状态、内联四方材料、Git diff 行号/颜色/空状态和可访问性语义保留。
- 没有 Push、部署、真实 GitHub/S3/COS 写入、生产数据库连接或 Git 历史改写。

## 2. 删除前安全证据

删除前创建了本地 annotated tag：

```text
v2-phase10-pre-removal-20260802-08a1c49
→ 08a1c4908c8890dad5284e9682304e1ac0c7550e
```

标签未 Push，未覆盖既有标签。恢复包在实现和自动验证期间位于带 marker 的本地临时根；
验收时该易失 `/tmp` 路径已被系统清理，原始校验结果保留在本文：

```text
/tmp/vinci-v2-phase10-pre-removal-08a1c49
```

删除前代码仓库清单：

| 集合 | 文件 | 字节 |
| --- | ---: | ---: |
| members | 32 | 15,208 |
| news | 2 | 4,447 |
| wiki | 226 | 2,565,860 |
| 合计 | 260 | 2,585,515 |

逐路径 SHA-256 清单摘要：

```text
7aea323bcdc27bb0da37a7023d409dd9fd249eb65c8190b54f0ed6e76b698656
```

删除前备份：

- `content.tar.gz`：SHA-256 `740ab40c47cc867145ef8361bee2206ab3b4edeaa876161329cf913de815d402`；
- `content-repository.bundle`：SHA-256 `0bce06bc42edc1c52d587a1060f17e63374b239aeb6be3fe5c2026cf1b38f261`；
- bundle 已通过 `git bundle verify`，包含完整历史；
- `content-files.sha256`、`immediate-pre-delete.sha256` 和从标签临时 worktree 恢复后的
  `post-delete-rollback.sha256` 字节完全一致，摘要均为上述 `7aea...`。

## 3. 数据库、独立仓库与恢复演练

隔离数据库与本地裸 Git 使用 `v2-phase9-manual-test`/`phase10` 归属标记和回环端口，未连接
生产资源。数据库投影到独立内容仓库后：

- 228 篇新闻/Wiki正式 Article；
- 32 名正式成员；
- 独立仓库 2 news、226 wiki、32 members；
- snapshot 228 article entries、32 member entries；
- manifest 260 files；
- 独立仓库 `main` HEAD `33da6612aeff549cd15ba33b3866ffbcefacee90`；
- 数据库↔文件↔snapshot↔manifest 一致性 `issueCount: 0`。

从该独立 snapshot 向两个名称含 `test` 的空 PostgreSQL 数据库执行了受控恢复：Dry Run
生成 mode 绑定确认令牌，Apply 各恢复 228 articles、228 article revisions、32 members、
32 member revisions；没有普通应用启动自动导入，也没有覆盖非空数据库。

## 4. 实现内容

- 从 Nuxt 模块、配置、hook、transformer、页面和 CMS 正式预览删除 Nuxt Content。
- 删除 `@nuxt/content`、仅由其引入的 `better-sqlite3` 和不再直接使用的 MDC 依赖；显式保留
  Comark 渲染所需 Shiki 依赖。
- 新闻、Wiki、成员列表/详情/赛季、首页、搜索、Sitemap 和 RSS 固定走 PostgreSQL API。
- 动态内容 route rules 固定 SSR，不再构建期预渲染三类正式内容。
- Wiki 拼音路径、文档根、章节顺序和层级继续由 `utils/wiki-content-meta.ts` 与
  `utils/wiki-chapters.ts` 普通模块负责。
- 删除 `content.config.ts`、Nuxt Content transformer、三类正式内容目录和候选来源 HTTP API。
- runtime 镜像不复制正式 Markdown、不安装 Git/SSH；Dockerfile 在构建时断言 `/app/content`
  与 runtime `.md` 文件均不存在。
- Compose 应用槽位固定 database publish mode，不挂代码仓库 Git worktree/凭据；operations
  的独立内容仓库 workspace、对账与恢复入口保持。
- GitHub Actions 只构建 `application` runtime/operations 镜像；部署分类器、自动部署和部署器
  不再支持 `content` 模式，蓝绿候选、gateway 与健康检查未改变。
- Wiki/Comark/阶段 0 内容检查改为必须显式读取代码仓库外的独立 snapshot，并校验
  snapshot/manifest；普通 build 不读取该路径。
- PostgreSQL 备份不再收集退役的 CMS 代码仓库 Git worktree，改为记录独立内容仓库保护清单。

## 5. 数据库、API、依赖与环境变量

- Migration / Schema：无变化；继续使用 0000～0017。
- 删除 API：`GET /api/v2/content/config`；公开内容 API 本身路径不变，但不再受候选开关控制。
- 删除运行依赖：`@nuxt/content`、`better-sqlite3`、`@nuxtjs/mdc`。
- 新增直接运行依赖：`shiki`（Comark 高亮代码此前由被删除依赖传递提供）。
- 退役应用变量：`CONTENT_SOURCE_NEWS/WIKI/MEMBERS`、`CONTENT_CANDIDATE_ENV` 和代码仓库
  CMS Git worktree/SSH 变量。`CONTENT_PUBLISH_MODE` 在 Compose 固定为 `database`；非数据库
  模式只允许 `NODE_ENV=test` 的历史回归测试。
- 内容导出、对账、PR 导入、S3/COS 和受控恢复变量不变。

## 6. 自动验证

自动验证均在本机隔离资源或纯只读检查中完成：

- [x] 阶段 10 专项：4 files、33 tests；
- [x] 阶段 8 专项：1 file、13 tests；
- [x] 阶段 9 专项：5 files、36 tests；必须显式提供代码仓库外 snapshot；
- [x] 完整 CMS：15 files、109 tests；完整普通测试：19 files、131 tests；
- [x] `npm run typecheck` 与不设置 snapshot 变量的 production build；
- [x] 独立 snapshot 的 Phase 0、Comark、Wiki 完整性：260/260、0 render failure、
  0 compatibility issue，Wiki 226/226；
- [x] fresh PostgreSQL 从 0000→0017 共应用 18 条 Migration；`db:generate` 无 schema 变化；
- [x] Compose base/全部 profile config、全部 tracked shell syntax、阶段 7 operations、自动部署、
  自动部署安装器、部署缓存清理与备份恢复；
- [x] 实际 runtime Docker image 内无 `/app/content`、无 `.md`、无 Git/SSH；
- [x] HTTP 首页、新闻/Wiki/团队列表和详情、赛季筛选、搜索、canonical、Sitemap、RSS、健康
  检查均为 200，不存在路径为 404；
- [x] `npm audit` 与 `npm audit --omit=dev` 均为 0 vulnerability；
- [x] `git diff --check`、删除边界和新增行敏感信息扫描。

补充说明：第一次单独执行阶段 9 命令时没有传 `V2_CONTENT_SNAPSHOT_SOURCE`，因此按阶段 10
设计被环境前置检查拒绝；补齐外部 snapshot 后 36/36 通过。这不是产品测试失败，也证明全量
内容检查不会静默回读已经删除的代码仓库目录。production build 则刻意清除 snapshot 变量后
通过，证明普通构建不依赖外部内容仓库。

## 7. 安全检查与已知限制

- 删除前后只操作精确的三个 `content/` 子目录；没有宽泛删除仓库根、Home 或独立内容仓库。
- 回滚标签、tar、bundle、SHA 清单、恢复数据库和隔离运行环境在人工验收前均曾保留，便于取证。
  验收期间系统清理了易失的 `/tmp` 恢复包；维护者随后直接校验 annotated tag 的基线、固定
  `content` tree `c621880ed3e8d5f39335555c83ecedef834ffbe5` 和其中 260 个文件。回滚 tag 继续保留。
- 内容 snapshot 不能恢复用户、会话、草稿、完整审核/审计和全部历史；正常恢复仍必须使用
  PostgreSQL custom dump。
- 真实生产内容仓库写凭据、真实服务器蓝绿发布和代码 push 不属于本轮自动验证；需维护者在
  合规环境按人工步骤确认。

## 8. 回滚方法

优先使用新的普通 `git revert <阶段10实现Commit>` 生成向前回滚，不 reset/rebase/force push。
若只验证删除前内容，可从本地 annotated tag 创建临时 worktree，核对 260 文件 SHA 后删除该
临时 worktree；不得让旧 Markdown 覆盖 PostgreSQL。业务内容回滚使用 Revision restore；数据库
灾难恢复优先完整 dump，独立 snapshot 仅用于受控空库恢复。

## 9. 维护者人工验收准备

Codex 在交付时负责保留并说明：隔离 PostgreSQL、本地内容仓库、恢复证据、运行站点、runtime
镜像和回滚标签。维护者无需输入数据库 URL、Token、私钥或执行破坏性命令。异常时不要清理，
保留截图、Network 状态、相关 UUID/Revision、脱敏日志和对应步骤编号。

## 10. 人工验收步骤

### 10.1 代码仓库与独立仓库

1. 查看 Codex 提供的只读清单，确认代码仓库没有 `content/news`、`content/wiki`、
   `content/members`、`content.config.ts` 和 Nuxt Content transformer。
2. 查看独立内容仓库摘要，确认 2 news、226 wiki、32 members、snapshot 228+32、manifest 260，
   且一致性 `issueCount: 0`。
3. 异常时保留缺失/多余路径、文件 SHA、snapshot/manifest SHA 和仓库 HEAD；不要手工补文件。

### 10.2 前台、SEO 与 404

1. 打开 Codex 提供的隔离站点首页、`/news`、一篇新闻详情、`/wiki`、一篇多章节 Wiki、
   `/team`、成员详情和至少两个赛季筛选。
2. 预期列表/详情正文、目录、上下章、中文路径、图片、代码、表格和站内链接正常；刷新后仍是
   SSR 数据库内容，没有 Nuxt Content/SQLite 错误。
3. 查看页面标题、description、canonical 与 Open Graph；打开 `/sitemap.xml`、`/rss.xml`，
   再使用站内搜索并访问一个不存在路径，预期分别为有效内容和 404。
4. 异常时保留 URL、页面截图、Network status/response、Console 和脱敏服务日志。

### 10.3 CMS、发布与独立导出

1. 登录隔离 CMS，打开新闻/Wiki/成员详情和最终预览；预期与正式前台使用同一 Comark 显示。
2. 创建一个测试草稿，提交、由另一测试审核者批准并发布；刷新前台应立即看到数据库新 Revision。
3. 预期发布只创建数据库 Revision/Outbox，不触发代码仓库 Actions 或 runtime 镜像；隔离 Worker
   随后更新独立内容仓库普通 Commit。
4. 异常时保留 draft/article/member UUID、Revision、Outbox job、导出 Commit 与审计动作。

### 10.4 Vue 代码蓝绿发布

1. 只读检查阶段 10 的部署模拟结果：任意代码/文档变化均分类 `application`，候选仍是非活动
   `app-blue`/`app-green`，migration、健康检查、gateway reload 顺序保持。
2. 在你自己的测试部署环境提交 Vue 代码时，预期 Actions 构建同完整 SHA 的 runtime/operations
   镜像，服务器每分钟检查并完成蓝绿切换；本轮 Codex 不替你 Push 或部署。
3. 异常时保存完整 SHA、Actions job、当前/候选 slot、健康响应和脱敏容器日志。

### 10.5 Docker runtime 与恢复

1. 查看 Codex 提供的 runtime 镜像检查，确认 `/app/content` 不存在，且 `/app` 没有正式 `.md`；
   应用镜像没有 Git/SSH 客户端。
2. 查看删除后标签回滚演练，确认恢复出的 260 文件清单仍为 `7aea...`。
3. 查看两个空库 snapshot 恢复结果，确认各为 228 articles/revisions 与 32 members/revisions，
   并从恢复库打开页面验证内容。
4. 异常时保留镜像 ID、精确文件路径、恢复 run/report SHA 和数据库计数，不要直接删库重试。

### 10.6 PR 导入回归

1. 打开“外部内容导入”，确认安全边界是白话说明，评论/关闭不会 Merge、批准、发布或删除草稿/
   成员提案。
2. 执行本地 mock PR Dry Run，展开文件卡片内的 Base/Current/Proposed/Merge。
3. 预期中文动作/状态卡片、旧/新行号、绿色 `+`、红色 `-`、上下文、删除/冲突/新文章/敏感成员
   空状态、`aria-expanded`/`aria-controls` 均未回退；敏感 Proposed 不回显。
4. 不点击评论或关闭，除非你明确要验收本地 mock 外部动作；绝无 Merge。
5. 异常时保留 item/run ID、分类、截图和脱敏 Network response。

## 11. 人工验收记录

- 验收结论：通过，阶段 10 正式收尾。
- 维护者确认时间：2026-08-02。
- 实现 Commit：`88c059fcf4d686d543212117c46da9e1f83a0d88`。
- 验收修复 Commit：无产品代码修复；验收记录 Commit 由最终回复报告。
- 维护者确认原文：`V2 阶段 10 验收通过`。

维护者采用压缩的只读命令与浏览器步骤验收。命令确认代码/依赖、HTTP/Feed/404、runtime 镜像、
删除前 tag 和 260 文件均正常。验收中处理了两个环境准备问题：已停止的隔离应用/PostgreSQL
被重新启动；内容 snapshot 恢复库按设计不含用户，因此新建仅用于隔离验收的
`phase10admin` 并实际验证登录 API。维护者还确认被删除的是依赖 `@nuxt/content` 的
transformer 外壳；Wiki 拼音算法仍在普通 TypeScript 模块中，拼音 URL 正常。

确认后，6 个带阶段 9/10 精确 label 的隔离容器和 1 个 runtime 检查镜像已删除；测试数据库
随隔离 PostgreSQL 容器删除且不可恢复，相关端口释放。annotated 回滚 tag 保留。没有 Push、
部署、真实外部写入或 Git 历史改写；现在停止开发，不进入阶段 11。
