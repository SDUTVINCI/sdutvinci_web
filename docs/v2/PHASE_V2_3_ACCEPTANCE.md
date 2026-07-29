# V2 阶段 3：Comark 兼容验证、CodeMirror 和最终预览——实施与验收

## 1. 当前结论

- 实施日期：2026-07-29。
- 最高优先级依据：`docs/v2/VINCI_CONTENT_ARCHITECTURE_V2_REQUIREMENTS.md` 第 19 节。
- 实现状态：完成，自动化验证通过。
- 人工验收：按维护者要求，与阶段 2 一起执行；本文所有人工验收项保持未勾选。
- 阶段总体完成：未勾选。
- 生产状态：仍由 Nuxt Content 渲染；没有切换内容权威、发布事务或生产部署。
- 未 Push、未部署、未进入阶段 4。

## 2. 基线和范围

- 分支：`main`。
- 阶段 3 起始 HEAD：`7cdc8c330042e10a1810b5b784ff38fc63ea007e`。
- `origin/main`：`1752363a306d9c6bc0b44d1eb8a6ce359444637d`。
- 开始时工作区干净；本地 `main` 已领先远端，既有提交均未改写。
- 没有发现适用的 `AGENT.md` 或 `AGENTS.md`。
- 阶段 2 的人工验收和总体完成保持未勾选，等待与本阶段联合验收。

本阶段只增加 CMS 候选渲染器、最终预览、CodeMirror 源码编辑器、兼容层、批量
比较工具和测试。没有修改数据库、API、发布事务、前台内容来源、Nuxt Content
生产渲染或生产部署行为。

## 3. `{% include ... %}` 盘点和处置

实际内容里只存在以下三处完全相同的尾行：

- `content/members/teacher/张彦斐.md`
- `content/members/teacher/宫金良.md`
- `content/members/teacher/巩丽.md`

三处都是 `{% include section.html %}`。仓库当前工作树、全部 Git 对象以及初始可见提交
中均不存在 `section.html` 或 `_includes`；Nuxt Content 也不会执行 Jekyll/Liquid
include。因此它们没有可恢复的输出，只会以遗留语法存在。按维护者明确授权，本阶段
仅精确删除这三行及其前导空行，保留所有教师正文和 Frontmatter，没有批量改写其他
Markdown。

测试夹具和文档中的 `{% include ... %}` 不删除：兼容层把未知 Liquid/Jinja 模板标记
编码为可见文本，代码块中的原文保持不变，避免未知语法被静默吞掉。

## 4. 实现摘要

### 4.1 编辑和预览

- 源码模式使用 CodeMirror 6 Markdown 编辑器，支持换行、大中文文档和外部内容同步。
- CodeMirror 初始化失败时自动回退到原生 `textarea`。
- 草稿页保留可视化编辑，新增“最终效果预览”，形成可视化、源码、最终预览三种模式。
- 切到源码或预览不会从可视化编辑器重建 Markdown，也不会因切换而调用保存。
- 图片上传继续复用同一上传服务；可视化模式交给 Crepe，源码模式插入当前选区，
  预览模式使用无损追加回退。
- `VinciMarkdownRenderer` 是 CMS 最终预览和后续生产候选共用组件；阶段 3 没有把它
  接入生产前台。

### 4.2 Vinci Markdown 兼容层

- Comark 固定为 `0.5.1`，Nuxt 插件与渲染运行时使用同一版本。
- `<NuxtLink>` 映射为 Nuxt `NuxtLink`。
- MDC/Vue 组件、原始 HTML、GFM 表格和任务列表进入统一 AST。
- Shiki 提供代码高亮；亮色和暗色主题均固定版本。
- 标题 ID 使用 `github-slugger`，目录收集二至六级标题。
- 安全层阻断 `script`、`style`、`object`、`embed`、`base`、`meta`、`link`，移除事件
  属性和危险 URL；兼容旧内容所需的 HTTPS iframe。
- 被阻断标签显示为安全代码文本，不静默消失。

## 5. 全内容兼容报告

可复现报告：

```bash
npm run v2:comark:audit -- --write
```

报告保存在 `docs/v2/PHASE_V2_3_COMARK_COMPATIBILITY.json`，包含每个文件的 SHA-256、
语法计数、旧/新 AST 摘要、差异类型和解决状态。

- 扫描：260 篇。
- Comark 成功解析：260 篇。
- 渲染失败：0 篇。
- 对比无差异：227 篇。
- 存在已记录差异：33 篇，共 35 项。
- 主要差异：22 项硬换行、10 项链接识别、1 项空标题、1 项标题比较和 1 项代码块计数。

这些差异不会在阶段 3 自动改写正文，也不会被隐瞒。它们是阶段 4 影子 HTTP/DOM
比较和生产切换前需要继续判断的候选差异；报告为生产切换的阻塞证据，不是阶段 3
切换授权。

## 6. 数据库、API、依赖和环境变量

- 数据库：无 Migration、无表/列/索引变化、无数据写入。
- API：无新增或修改。
- 环境变量：无新增、修改或弃用。
- 生产配置：无变化。
- 新运行依赖：`@comark/nuxt@0.5.1`、`@nuxtjs/mdc@0.22.2`、
  `codemirror@6.0.2`、`@codemirror/lang-markdown@6.5.1`、
  `@codemirror/state@6.5.2`、`@codemirror/view@6.39.16`、
  `github-slugger@2.0.0`、`@shikijs/themes@4.3.1`。
- 新开发依赖：`@vue/server-renderer@3.5.40`。
- 安装完成后 `npm audit` 报告 0 个漏洞。

`@nuxtjs/mdc` 的显式版本只用于稳定旧 Nuxt Content 解析基线和对比工具；Nuxt Content
本身继续保留。

## 7. 自动验证

最终提交前必须全部通过，并在交接记录及最终回复写入实际结果：

```bash
npm run v2:comark:audit -- --write
npm run v2:phase0:audit
npm run wiki:check
TEST_DATABASE_URL='<isolated-postgresql-17-url>' npm test
npm run test:backup-restore
./tests/auto-deploy.integration.sh
./tests/install-auto-deploy.integration.sh
npm run test:deploy-cache-cleanup
npm run typecheck
npm run build
git diff --check
```

数据库测试只能连接明确隔离的测试 PostgreSQL；备份和部署测试只能使用临时 Compose
project、临时目录、本地测试仓库和无效外部端点，不得接触生产资源。

## 8. 阶段 2 + 阶段 3 联合人工验收

### 8.1 前置条件

1. 使用隔离 PostgreSQL 17、隔离 Git bare remote 和独立测试 worktree。
2. 不使用生产 `DATABASE_URL`、生产 Git 凭据、生产 S3/COS 凭据或生产服务器。
3. 安装与 lockfile 一致的依赖：`npm ci`。
4. 保留当前 Commit SHA，若任何步骤异常立即停止，不 Push、不部署。

### 8.2 基线和范围

```bash
git status --short
git branch --show-current
git log --oneline --decorate -8
git diff 7cdc8c330042e10a1810b5b784ff38fc63ea007e..HEAD --stat
git diff 7cdc8c330042e10a1810b5b784ff38fc63ea007e..HEAD -- \
  content/members/teacher/张彦斐.md \
  content/members/teacher/宫金良.md \
  content/members/teacher/巩丽.md
rg -n '\\{%\\s*include\\b' content
```

预期：分支为 `main`、工作区干净；最后一个命令无输出；内容差异只精确删除三处无效
include，正文仍完整。失败时不要清理或回退来源不明改动，记录输出并停止。

### 8.3 阶段 2 数据链路

严格按 `docs/v2/PHASE_V2_2_ACCEPTANCE.md` 第 11、12 节执行隔离 Migration、影子发布、
Push 失败、幂等、历史、Diff、Git/DB 恢复、权限和对账测试。预期只在
`NODE_ENV=test` 与 `CONTENT_PUBLISH_MODE=revision_shadow` 下开放影子入口；切回
`legacy_git` 后完全恢复旧行为。任何生产连接迹象都必须立即停止。

若使用 `npm run build` 生成的 `.output` 做验收，还必须先执行阶段 2 验收文档第 15 节
的运行时 `NODE_ENV` 检查；不得复用修复前的生产构建产物。

首次发布后从文章列表再次进入同一文章前，还必须确认临时 app 已包含阶段 2 的
“影子文章索引读取一致性”修复，并从该 Commit 重新构建。若第二次提交审核提示
“当前文章已有更新”，不要点击重新同步或重建草稿；按阶段 2 验收文档第 16 节保留
当前隔离草稿原地恢复，再继续本节。

### 8.4 批量兼容

```bash
npm run v2:comark:audit -- --write
node -e "const r=require('./docs/v2/PHASE_V2_3_COMARK_COMPATIBILITY.json'); console.log(r.summary)"
```

预期：260/260 成功、0 render failure；差异为 33 篇/35 项。逐项抽查报告中的
`path`、`issues`、`legacy` 和 `comark`，确认没有文件被跳过。数字变化时先判断是否有
新的内容提交，不得直接接受。

### 8.5 启动 CMS 测试环境

使用隔离数据库和测试配置启动：

```bash
DATABASE_URL='<isolated-postgresql-17-url>' \
NODE_ENV=development \
npm run dev
```

预期：终端显示本地 URL，无 Migration/数据库连接错误。只访问本机地址。失败时保留
日志并停止，不改生产配置。

### 8.6 普通 Wiki 三模式

1. 使用测试管理员登录 CMS，打开一篇普通 Wiki 草稿。
2. 记录初始 Markdown 和浏览器 Network 请求数量。
3. 依次点击“可视化编辑”“Markdown 源码”“最终效果预览”，每种模式来回两次。
4. 确认源码模式有行号/语法着色，中文输入和撤销正常。
5. 确认最终预览的标题、段落、强调和链接正确。
6. 不点击保存直接离开再回来，确认没有因切换产生保存请求或正文变化。

预期：三模式可用、切换不会错误保存或破坏 Markdown。异常时复制原文和 Network
请求，停止验收。

### 8.7 复杂语法和安全边界

分别打开包含代码、表格、图片、目录、`<NuxtLink>`、MDC、原始 HTML 的 Wiki，核对：

1. 代码高亮且代码内容完整。
2. 表格在窄屏可横向滚动。
3. 图片 URL、alt 和标题不变。
4. 中文重复标题锚点唯一，目录可跳转。
5. `NuxtLink` 为站内导航，MDC/HTML 不被静默吞掉。
6. 未识别 `{% ... %}`、`{{ ... }}` 以可见文本显示。

在仅供测试的草稿中加入：

```html
<script>alert('xss')</script>
<img src="javascript:alert(1)" onerror="alert(2)">
<iframe src="https://example.com/embed"></iframe>
```

预期：脚本变为安全代码提示，事件属性和危险 URL 消失，HTTPS iframe 保留；浏览器
不能弹窗。不要发布该草稿；验收后用正常编辑操作移除测试文本。

### 8.8 锁、自动保存和三模式图片

1. 用两个浏览器会话打开同一测试草稿，确认第二个会话受到既有编辑锁保护。
2. 在可视化模式上传测试图片，确认插入并保存。
3. 在源码模式把光标放到指定位置上传，确认 Markdown 插入选区且只保存一次。
4. 切到最终预览再上传，确认使用明确的无损追加行为；切回源码核对原文。
5. 模拟上传失败，确认正文不变且错误可见。
6. 等待自动保存，刷新后逐字对比 Markdown。

预期：锁、CSRF/Origin、自动保存和上传权限继续有效，三种模式不丢正文。只允许使用
隔离测试对象存储或现有测试替身，禁止生产桶。

### 8.9 前台未切换和最终验证

```bash
rg -n "VinciMarkdownRenderer|Comark" app/pages app/components
npm run wiki:check
npm run typecheck
npm run build
git diff --check
git status --short
```

预期：渲染器只接入 CMS 草稿最终预览，普通新闻/Wiki 前台仍是 Nuxt Content；所有命令
成功，工作区干净。确认后分别明确回复：

```text
V2 阶段 2 验收通过
V2 阶段 3 验收通过
```

## 9. 失败处理和回滚

- UI 或兼容检查失败：保留草稿原文、路径、浏览器控制台、Network 和报告条目；关闭
  测试服务，不切换任何生产开关。
- 数据链路失败：按阶段 2 文档切回 `CONTENT_PUBLISH_MODE=legacy_git`；保留已追加
  Revision 作为审计，不删除数据库历史。
- 阶段 3 代码回滚：在无来源不明改动的干净工作区执行
  `git revert <阶段3-commit-sha>`，再运行完整测试、typecheck、build 和 diff check。
- 三个无效 include 若维护者决定恢复，应通过新的审查 Commit 精确恢复对应两行；不得
  hard reset、Force Push 或批量覆盖 `content/`。
- 阶段 3 没有数据库 Migration，所以没有数据库 down 操作。

## 10. 安全注意事项

- 不把真实 URL、密码、Token、Cookie、备份或生产对象写入命令历史、报告或 Commit。
- 测试数据库、Git remote、S3/COS、临时目录和容器名称必须显式带 test/phase3 标识。
- 不对 `SDUTVINCI/sdutvinci_content` 取得写权限，不复制、清空或覆盖其内容。
- 不将开发服务器暴露到公网；验收完成后停止测试进程并清理隔离资源。
- 不因报告无 render failure 就批准生产切换；33 篇语义差异仍需后续影子对比。

## 11. 验收勾选

- [ ] 我已完成阶段 2 的全部人工验收。
- [ ] 我已检查普通 Wiki 的三种编辑/预览模式。
- [ ] 我已检查代码、表格、图片、目录和扩展语法。
- [ ] 我已确认模式切换、锁、自动保存和三模式上传不破坏 Markdown。
- [ ] 我已确认 XSS 边界和最终预览效果。
- [ ] 我已逐项理解兼容报告中的阻塞差异。
- [ ] 我已确认生产前台、内容权威和发布事务没有改变。
- [ ] 我已明确回复“V2 阶段 2 验收通过”。
- [ ] 我已明确回复“V2 阶段 3 验收通过”。

本阶段总体完成项保持未勾选，直到维护者完成上述步骤并明确验收。
