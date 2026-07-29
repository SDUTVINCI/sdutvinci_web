# V2 阶段 4：前台数据库读取与 Comark 影子运行验收

> 最高优先级依据：
> `docs/v2/VINCI_CONTENT_ARCHITECTURE_V2_REQUIREMENTS.md` 第 20 节。
>
> 本阶段只建立可回退的数据库/Comark 候选。生产默认、内容权威和发布事务仍是
> `legacy_git` / Nuxt Content / Git-first。只有维护者明确回复
> “V2 阶段 4 验收通过”后，阶段 4 总体完成项才可勾选；不得提前进入阶段 5。

## 1. 当前状态

- 实现状态：代码与自动验证完成，等待维护者人工验收。
- 生产默认：`legacy_git`，候选环境 `disabled`。
- 生产发布：仍为 Git-first；缓存失效 API 未接入发布事务。
- 内容来源：代码仓库 `content/` 和 Nuxt Content 仍完整保留。
- 独立内容仓库：未读取、未写入、未导出。
- 发布状态：未 Push、未部署、未进入阶段 5。

## 2. 实现范围

### 2.1 统一查询和页面候选

`server/services/public-content.ts` 是新闻、Wiki、成员和搜索的统一数据库查询层：

- 新闻列表与详情使用 `articles.current_revision_id` 单次连接
  `article_revisions`，只返回 `is_present=true` 且未删除的当前 Revision。
- Wiki 同样读取当前 Revision，并复用冻结的 Wiki 路径元数据生成文档根、
  `docKey`、章节层级和排序字段；前台从同一列表计算目录、上一页和下一页。
- 成员列表读取 `members` 的结构化投影；详情正文在阶段 9 前只读回退到
  `source_path` 对应的 legacy Markdown。成员权威没有切换。
- 搜索在数据库内匹配标题、相对路径和当前 Revision 正文，单次连接查询并限制
  100 条，不在结果循环中发起查询。

新闻、Wiki 和成员详情在 `database` 候选模式下都使用
`VinciMarkdownRenderer`。CMS 草稿“最终效果预览”继续使用同一组件和
`shared/utils/vinci-markdown.ts`，因此候选前台与最终预览复用同一 Comark、
标题 ID、代码高亮和安全管线。

### 2.2 来源开关

三个集合分别使用：

```text
CONTENT_SOURCE_NEWS=legacy_git|database_shadow|database
CONTENT_SOURCE_WIKI=legacy_git|database_shadow|database
CONTENT_SOURCE_MEMBERS=legacy_git|database_shadow|database
CONTENT_CANDIDATE_ENV=disabled|test|staging
```

- 未配置时全部为 `legacy_git`，环境为 `disabled`。
- `database_shadow` 同时查询 legacy 和数据库候选，但 HTTP 响应仍使用 Nuxt
  Content；候选失败只记录去敏警告，不改变旧响应。
- `database` 返回数据库当前 Revision，并由 Comark SSR。
- `test` 还要求 `NODE_ENV=test`；`staging` 是显式预发布声明。
- 候选环境未显式开启时，任何 `database_shadow` / `database` 配置都会 fail
  closed。生产 Compose 默认值仍是 `legacy_git + disabled`。

### 2.3 SEO、Feed、缓存和 API

所有接入页面统一生成 title、description、Open Graph 和 canonical。
数据库候选另外提供：

| 路径 | 作用 | 默认关闭行为 |
| --- | --- | --- |
| `GET /api/v2/content/config` | 返回已校验的集合来源配置 | 可读安全默认 |
| `GET /api/v2/content/news` | 新闻列表候选 | 404 |
| `GET /api/v2/content/news/**` | 新闻详情候选 | 404 |
| `GET /api/v2/content/wiki` | Wiki 列表/导航候选 | 404 |
| `GET /api/v2/content/wiki/**` | Wiki 详情候选 | 404 |
| `GET /api/v2/content/members` | 成员列表候选 | 404 |
| `GET /api/v2/content/members/:slug` | 成员详情候选 | 404 |
| `GET /api/v2/content/search` | 当前 Revision 数据库搜索 | 404 |
| `GET /sitemap.xml` | 数据库 Sitemap 候选 | 404 |
| `GET /rss.xml` | 数据库新闻 RSS 候选 | 404 |
| `POST /api/cms/v2/content-cache/invalidate` | 管理员精确缓存失效 | 登录、admin、同源、CSRF |

详情缓存键格式为
`phase4:<collection>:<articleId>:revision:<revisionId>`。进程内缓存 TTL 为 5 分钟，
最多 512 项；接口可按集合、文章 UUID 或 Revision UUID 精确失效。本阶段没有从
`cms-publishing.ts` 调用该接口，也没有修改正式发布事务。

## 3. 数据库、依赖和配置变化

- 数据库 Migration：无。
- Schema：无变化，复用阶段 1/2 的 `article_revisions` 和
  `current_revision_id`。
- 新运行依赖：无。
- 新开发依赖：`parse5@8.0.1`，仅用于确定性 HTTP/DOM 报告解析。
- 新环境变量：四个内容来源变量；`.env.example` 和 Compose 都给出安全默认值。
- SSR：动态内容页不再预渲染，以便同一构建在测试/预发布运行时切换来源；静态页面
  继续预渲染。Nuxt Content 和 `content/` 没有删除。

## 4. 自动验证记录

自动数据库资源为：

- 容器：`vinci-v2-phase4-test-db`
- 数据库：`vinci_v2_phase4_test`
- 本机绑定：`127.0.0.1:55444`

它与现有普通数据库、生产数据库、阶段 2/3 人工验收库均不同。
`TEST_DATABASE_URL` 从未等于 `DATABASE_URL`。旧
`/tmp/vinci-v2-phase2-acceptance.*` 只读盘点后未修改或删除。
自动验证结束后已精确删除该阶段 4 容器；没有遗留 phase4 自动数据库或 HTTP 进程。

已通过：

- `npm run test:v2:phase4`：1 个文件，8/8。
- `npm run test:cms`：11 个文件，66/66，包含阶段 4 数据库专项。
- `npm test`：4 个文件、16 项通过；8 个数据库文件在未提供测试 URL 时安全跳过，
  其数据库路径已由上一条 66 项覆盖。
- `npm run v2:phase0:audit`：通过，仍为 260 个 Markdown。
- `npm run wiki:check`：226 个 Wiki 文件通过。
- `npm run typecheck`：通过。
- `npm run build`：通过；处理 260 个内容文件。
- `bash -n scripts/v2-phase4-manual-acceptance.sh`：通过。
- `git diff --check`：通过。

数据库专项覆盖安全默认、候选环境限制、单次连接查询、current Revision、新闻、
Wiki 元数据和章节顺序、成员候选、搜索、Sitemap、RSS、Revision 缓存键、精确失效、
删除/缺失返回空以及发布事务未接缓存接口。

## 5. HTTP/DOM 影子对比

完整报告：
`docs/v2/PHASE_V2_4_HTTP_DOM_COMPARISON.json`。

对比使用同一个生产构建的两个本机实例：

- `legacy_git + Nuxt Content SSR`
- `database current_revision + Comark SSR`

结果：

- 270 条路由对比。
- 267 组页面双方均为 HTTP 200。
- 新闻、Wiki、成员各一条缺失路径双方均为 HTTP 404。
- 0 个状态、关键标题或 SEO 缺失级别的不匹配。
- 212 条关键 DOM 等价。
- 33 条页面携带阶段 3 已知差异。
- 25 条额外非阻断差异被明确记录。
- 7 个配置、候选 API、搜索、Sitemap、RSS 探针全部通过。

阶段 3 的 33 篇/35 项已按源文件逐项完整映射：

- 33/33 文件进入 HTTP 报告。
- 35/35 issue 原样保留。
- 没有批量改写 Markdown，也没有用内容改写消除差异。

额外 25 条由 16 条 description/`og:description` 来源差异和 9 条 Comark
原始 HTML、空白文本或标签/标题结构差异组成；报告保留每个路径、两侧快照和差异字段。
这些条目没有 HTTP 状态、页面主标题或 SEO 缺失阻断，但仍是人工抽查对象，不能解释为
“完全无差异”。

## 6. 已知限制

1. 成员尚无正式 Revision 模型；成员结构化字段来自数据库，详情正文只读 legacy
   `source_path`。阶段 4 不切换成员权威。
2. 缓存是单进程、有界候选缓存；发布事务没有失效调用，多实例广播属于后续权威切换
   设计，不在本阶段伪装完成。
3. `database_shadow` 的候选失败目前只写去敏服务器警告，没有持久指标系统。
4. 33 篇/35 项阶段 3 差异和 25 条额外 HTTP/DOM 差异需要维护者浏览器抽查。
5. Sitemap/RSS 仅在 `database` 候选响应模式开放；默认旧行为仍为 404。
6. 没有部署测试环境、生产容器或真实域名，因此生产部署行为未被改变或声称验收。

## 7. 浏览器优先人工验收

### 7.1 启动

从仓库根目录只运行：

```bash
./scripts/v2-phase4-manual-acceptance.sh start
```

脚本只创建 `vinci-v2-phase4-manual-test-db` 和
`/tmp/vinci-v2-phase4-manual-test`，使用 `vinci_v2_phase4_manual_test` 数据库，
并启动：

- 旧前台：<http://127.0.0.1:34150>
- 数据库候选：<http://127.0.0.1:34151>

预期终端打印两个 URL；任何失败会精确清理本脚本拥有的资源。若提示同名资源已存在，
不要手工强删，先运行 `status` 并检查归属。

### 7.2 新闻与 SEO

1. 在两个浏览器标签分别打开 `/news`。
2. 确认列表数量、标题、日期、图片和链接目标一致。
3. 打开 `/news/2024-07-06` 和
   `/news/2026-07-16-robocon-volleyball-national-first-prize`。
4. 确认正文、视频/图片、标签和返回链接可用。
5. 在开发者工具 Elements 中检查 `<title>`、description、`og:title`、
   `og:description`、`og:url` 和 canonical 均存在。
6. 打开 `/news/__phase4-missing`，两侧都应显示 404。

失败时记录 URL、截图、Console 和 Network 响应；不要改 Markdown 或开启生产开关。

### 7.3 Wiki 导航与复杂内容

1. 两侧打开 `/wiki`，确认文档数、章节数和目录分组一致。
2. 选一篇多章节文档，从索引依次点击两节，确认章节编号、左侧目录、上一页和下一页。
3. 抽查报告中的：
   - C++“结构体与共用体”（标题结构差异）；
   - STM32 FreeRTOS“stm32 单片机”（`pre`/`br` 差异）；
   - ROS2 或 Linux 教程中的链接/换行差异。
4. 检查页内目录、中文锚点、代码复制、表格横向滚动、图片放大和阅读进度。
5. 用浏览器响应式模式分别检查 390px 宽和桌面宽度。
6. 打开 `/wiki/__phase4-missing`，两侧都应为 404。

允许看到报告已记录的结构差异；若出现未记录的正文丢失、脚本执行、导航错序或 500，
视为失败并停止验收。

### 7.4 成员、搜索和 Feed

1. 两侧打开 `/team`，检查成员数量、分组、筛选和卡片。
2. 打开普通成员和带大量原始 HTML 的 `董佳辉` 详情，检查正文、图片和外链。
3. 打开 `/api/v2/content/config`：34150 应全为 `legacy_git`，34151 应全为
   `database`。
4. 在 34151 打开
   `/api/v2/content/search?q=机器人`、`/sitemap.xml`、`/rss.xml`，应分别返回
   JSON、XML Sitemap 和 RSS；34150 的候选路径应为 404。
5. 打开 `/team/__phase4-missing`，两侧都应为 404。

### 7.5 关闭开关和清理

旧前台 34150 就是关闭所有数据库候选后的同构建结果。确认它仍可浏览后运行：

```bash
./scripts/v2-phase4-manual-acceptance.sh stop
```

预期两个本机端口停止，`vinci-v2-phase4-manual-test-db` 被删除，临时 PID/日志目录被
精确删除；现有普通数据库、阶段 2/3 资源和旧 `/tmp` 目录不受影响。失败时运行
`status`，不要使用宽泛的 `docker system prune`、递归删除或清理其他容器。

## 8. 回滚

代码回滚使用：

```bash
git revert <阶段4实现Commit-SHA>
```

然后重跑阶段 4 专项、CMS 回归、typecheck、build 和 diff check。即时运行时回退只需
把三个 `CONTENT_SOURCE_*` 设为 `legacy_git`，把
`CONTENT_CANDIDATE_ENV` 设为 `disabled` 并重启测试实例。没有 Migration down、
Revision 删除、内容仓库操作、hard reset 或 Force Push。

## 9. 验收勾选

### 自动与实现

- [x] 统一查询、新闻、Wiki、成员、搜索、Feed 和缓存候选已实现。
- [x] 默认关闭、集合级开关和测试/预发布限制已验证。
- [x] Comark SSR 与 CMS 最终预览复用相同管线。
- [x] 404、删除、旧新闻路径和关闭候选行为已验证。
- [x] HTTP/DOM 报告已覆盖 33 篇/35 项阶段 3 差异。
- [x] 专项、相关回归、typecheck、build 和 diff check 已通过。
- [x] 未修改发布事务、未批量修改 Markdown、未接入内容仓库。
- [x] 未接触生产资源、未 Push、未部署、未进入阶段 5。

### 维护者人工验收

- [ ] 我在隔离测试环境切换并检查新闻数据库来源。
- [ ] 我在隔离测试环境切换并检查 Wiki 数据库来源。
- [ ] 我检查桌面端和手机端。
- [ ] 我检查目录、锚点、上一页、下一页、图片放大和阅读进度。
- [ ] 我抽查 33 篇/35 项及额外 25 条报告差异。
- [ ] 我确认关闭开关后旧前台恢复。
- [ ] 我明确回复“V2 阶段 4 验收通过”。

### 阶段总体

- [ ] V2 阶段 4 人工验收完成。
- [ ] 允许开始 V2 阶段 5。

## 10. Commit

本验收文档与阶段 4 实现放在同一个独立本地 Commit。最终 SHA 由最终回复报告；
文档不预填自身 Commit SHA。该 Commit 不 Push、不部署。
