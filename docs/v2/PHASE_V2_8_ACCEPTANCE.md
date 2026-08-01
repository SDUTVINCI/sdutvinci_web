# V2 阶段 8 自动验证与人工验收记录

状态：实现、自动验证和维护者人工验收均已通过。未 Push、未部署、未进入阶段 9。

## 1. 实现范围

- Migration `0016_flowery_war_machine.sql`：独立 PR run/item/external action、redirect、草稿
  提案列和 `content_importer` 角色，expand-only。
- GitHub REST reader：PR Base/Head、分页 Diff、commit-bound contents、限流/5xx 重试及
  mock-only 评论/关闭；没有 Merge。
- Dry Run：Base snapshot、stable vinciId、数据库 Current、四方材料、十类结果、部分导入
  和 PR/Head 幂等。
- 三方合并：不同段落自动合并，同段冲突 fail closed；导入前事务锁和 Current 复核。
- 草稿流程：安全/自动合并、新文章、同目录移动和删除只创建 draft/proposal；正常审核
  发布后才创建 Revision、Article、redirect 或 deletion outbox。
- CMS：管理员/`content_importer` 专属入口、分类计数、选择项、冲突/引用详情、四方材料、
  audit/external action 状态和显式评论/关闭。
- 文件安全：路径穿越、跨目录/collection、manifest 外文件、members、重复 ID/路径、
  symlink、非 file、二进制、非法 UTF-8/base64、大文件、HTML/Vue/MDC/未知语法拒绝或突出。

详细设计见 `docs/v2/PR_IMPORT.md`。

## 2. 自动验证证据

阶段 8 专项使用名称含 `test` 的独立 PostgreSQL、带唯一前缀的临时本地裸 Git 远端和
内存 mock GitHub API：

```text
npm run test:v2:phase8
Test Files  1 passed (1)
Tests       10 passed (10)

npm run test:cms
Test Files  15 passed (15)
Tests       105 passed (105)

npm test（无数据库普通模式）
Test Files  4 passed | 12 skipped (16)
Tests       17 passed | 95 skipped (112)
```

专项覆盖 Base==Current 草稿、Base!=Current 不覆盖、不同/同段比较、其他 Revision/文章与
未改文件不受影响、新增/移动/删除、路径/redirect/vinciId、部分导入、重复 PR/Head、
角色/仓库/PR、路径穿越、重复路径、高风险/未知语法、symlink/大文件/二进制/编码、分页、
重试、失败、评论、关闭、审计/脱敏，以及导入后零正式 Revision、人工审核发布后才生效。

还通过：typecheck、production build、wiki check、Drizzle no-change generate、Migration
真实执行、Compose config、全部 shell syntax、`git diff --check` 和代码仓库 `content/`
Markdown 字节清单复核。最终命令和哈希记录在本文件第 6 节，人工验收完成前不把阶段 8
总体进度标为完成。

## 3. 自动验收中发现并修复的问题

首次容器化浏览器夹具中，Nitro production bundle 把 `process.env.NODE_ENV` 编译为
build-time `production`，使运行时明确设置 `NODE_ENV=test` 的本地 mock 被拒绝。证据是
隔离应用返回 500，容器日志仅含 `CONTENT_PR_IMPORT_TEST_MODE 只允许 NODE_ENV=test`，
数据库没有创建 run/draft。

修复为通过 `Reflect.get(process.env, 'NODE_ENV')` 做运行时守卫；正式 production 仍拒绝
mock URL。重建后同一夹具得到 7 files / 5 importable / 2 blocked，分类依次为 safe、
auto merge、content conflict、new、rename、delete、high risk。随后清空这次 smoke 的
run/audit/session，当前人工环境重新处于 0 run、0 item、0 draft、9 条初始正式 Revision。

最终 fresh-migration 复验时，第一次只删除隔离测试库的 `public` schema 而遗漏 Drizzle
journal schema，迁移器因此认为表已存在，10 项在 beforeEach 统一以 relation missing
失败，业务测试体未运行。保留输出后同时重建 `drizzle` 和 `public`，从 0000→0016
重新迁移，约束存在性核对通过，阶段 8 专项恢复 10/10；这属于测试库重置操作错误，不是
产品代码回归。

最终完整 CMS 重跑时第一次手工拼接了错误的隔离数据库账号，13 个数据库套件均在连接
认证阶段退出，业务测试体未运行，另 2 个静态套件通过。保留输出并从测试容器只读核对
实际测试账号后，以正确连接重跑，最终 15 files / 105 tests 全部通过；这同样属于验证
命令参数错误，不是产品代码回归。

## 4. 人工验收环境

人工验收期间使用：

- CMS：`http://127.0.0.1:34162/cms/login`
- 账号：`phase8admin`
- 密码：`Phase8Manual123!`
- 仓库：`SDUTVINCI/sdutvinci_content`
- PR：`8`
- Base：`3f79ada96080111b72432fff5e1b70bccd7e4344`
- Head：`33449db2bc7d4e7a351351c1d3747e0efb5b3a1b`

资源是三个带 `com.sdutvinci.scope=v2-phase8-manual-test` 标签的容器、本地裸 Git 远端、
测试 PR fixture 和回环 mock API。没有真实 GitHub 请求或写操作，不需要真实 GitHub
Token；“评论”和“关闭”只写本地 JSONL/state。代码仓库现有 `content/` 不作为夹具写入
目标，也没有被修改。维护者明确验收通过后，这些资源已按名称、标签和 marker 精确清理。

异常时不要刷新、关闭页面或自行清理。保留截图（含分类/路径/时间）、浏览器 Network 的
request URL/status/response、Console 输出，并告诉 Codex；Codex 会保留容器、数据库、
本地 Git object、mock action 和日志后修复、重跑受影响专项/完整 CMS/typecheck/build。

## 5. 一次性浏览器验收步骤

以下全部操作只针对上述隔离环境。

### 5.1 登录与入口权限

1. 打开 CMS URL，用上述账号密码登录。
2. 预期：进入工作台，左侧出现“外部内容导入”；页面警告明确写着不会批准、发布或
   Merge，高风险和冲突默认阻止。
3. 异常证据：登录/入口截图、Network 中 session 或页面请求状态、Console。

### 5.2 完整 Dry Run 与分类

1. 点击“外部内容导入”，仓库保持 `SDUTVINCI/sdutvinci_content`，PR 输入 `8`，点击
   “执行完整 Dry Run”。
2. 预期：显示上述 Base/Head；总数 7、可导入 5、阻止/冲突 2；七项分别是：
   - `wiki/phase8/safe.md`：安全修改；
   - `wiki/phase8/automatic.md`：可自动合并；
   - `wiki/phase8/conflict.md`：内容冲突、不可选择；
   - `∅ → wiki/phase8/new.md`：新文章，有数据库预分配 UUID；
   - `wiki/phase8/old-name.md → wiki/phase8/new-name.md`：移动或重命名；
   - `wiki/phase8/delete.md → ∅`：删除提案；
   - `wiki/phase8/risky.md`：高风险 HTML/Vue/MDC、不可选择。
3. 展开 conflict 和 move 的“冲突/路径/引用审计详情”。预期 conflict 有行范围；move
   有旧/新公共路径和 referenceCount，不显示远端 URL、Token、数据库 URL或绝对路径。
4. 异常证据：完整列表和详情截图、dry-run Network response（先确认没有敏感值）。

### 5.3 四方材料与三方算法

材料标题依次显示为 `Base Source（PR 分支起点内容）`、
`Current Source（数据库当前正式内容）`、`Proposed Source（PR 提议的新内容）` 和
`Merge Result（三方合并后的草稿候选）`。点击某文件的查看按钮后，材料应直接展开在该
按钮下方；点击“收起三方审计材料”或“关闭”后原地收起，不应跳到整页底部。

1. 点 safe 的“查看 Base / Current / Proposed / Merge”。预期 Base=Current，Proposed 和
   Merge 都含“安全 PR 修改”。关闭材料。
2. 点 automatic。预期 Base 两段都是 Base；Current 含“第一段数据库 Current 修改”；
   Proposed 含“第二段 PR 修改”；Merge 同时包含这两处修改。
3. 点 conflict。预期 Base、Current、Proposed 三者不同，Merge 显示“（无）”，该项不可选。
4. 点 risky。预期 Proposed 明显显示 `<script>`，分类/警告突出且不可选，没有被当作安全项。
5. 异常证据：对应四方材料截图、item artifact Network response 和 conflict detail。

### 5.4 部分导入、安全修改与重复导入

1. 默认 5 个安全项已选中。先取消 automatic、new、move、delete，只保留 safe，点击
   “只导入所选安全项目（1）”。
2. 预期：提示只创建数据库草稿；safe 状态 imported 并显示 draft UUID；其他四个安全项
   仍 pending，两个风险项仍未导入。
3. 再次填写同一仓库和 PR 8，执行 Dry Run。
4. 预期：Base/Head 和 run 不变，safe 仍是同一个 imported draft，不能再次选择；没有
   产生重复 run 或草稿。其余四个 pending 项被选中。
5. 异常证据：两次页面状态截图、第二次 dry-run response 中 run/item/draft ID。

### 5.5 自动合并、新增、移动、删除提案

1. 保持剩余 automatic、new、move、delete 四项选中，点击“只导入所选安全项目（4）”。
2. 预期：总计 5 个 imported；conflict/risky 仍未导入。打开左侧“草稿”，预期共 5 个
   阶段 8 草稿/提案，没有冲突或高风险草稿。
3. 打开“不同段落自动合并”草稿，预期正文同时含数据库第一段修改和 PR 第二段修改，
   状态仍是草稿，可保存/提交审核，但未批准未发布。
4. 打开“PR 新文章”草稿，预期为新文章草稿；正式文章列表中还没有它。
5. 打开“重命名提案”和“删除提案”，预期标题区域明确显示 proposal 类型；正式文章的
   路径仍是 `old-name`，delete 文章仍存在。
6. 异常证据：草稿列表、各草稿详情、正式文章列表和相关 Network response。

### 5.6 正式内容未自动发布

1. 打开正式“文章”列表/详情核对：安全修改仍显示 Base 正文；自动合并正式内容只包含
   已有数据库 Current，不包含 PR 第二段；旧路径文章仍未改名；删除文章仍存在；新文章
   不在正式列表。
2. 回到工作台/草稿，确认没有 imported draft 自动变为 approved/published，也没有新增
   正式 Revision 的 UI 迹象。
3. 预期：阶段 8 导入结果只能继续走现有提交审核、另一审核者批准、管理员发布流程。
   本轮人工验收不要实际发布，以便一次性验证“导入不发布”。
4. 异常证据：正式详情和草稿状态截图、article/history Network response。

### 5.7 显式 mock 外部写与审计状态

此步不访问真实 GitHub，但仍用于验收独立授权边界；放在最后，因为关闭后不能重新 Dry Run。

1. 回到当前导入 run，点击“明确授权：评论 PR”；浏览器确认框中核对“不 Merge 或发布”，
   再确认。
2. 预期：成功提示；external action 列表出现 `comment · succeeded`。评论只含 PR 编号、
   Head 和数量摘要，不含文章正文/Token/URL/绝对路径。
3. 点击“管理员明确关闭 PR”，核对确认框后确认。
4. 预期：action 列表出现 `close · succeeded`；没有 Merge、发布或 Revision 变化。
5. 异常证据：两个确认框、成功/失败状态、Network request/response；不要复制 Authorization。

### 5.8 回报结果

请一次性告诉 Codex：

- 5.1～5.7 是否逐项符合预期；
- 若通过，明确回复“V2 阶段 8 验收通过”；
- 若有问题，指出步骤、item 路径和已保留的证据，不要勉强判定通过。

维护者已明确回复“V2 阶段 8 验收通过”。随后 Codex 执行
`npm run v2:phase8:manual -- inspect` 保存只读摘要，再运行 `stop` 精确清理全部人工资源。

## 6. 最终自动验证记录

在阶段 8 实现 Commit 前必须再次执行并记录：

- [x] `npm run test:v2:phase8`
- [x] `npm run test:cms`
- [x] `npm test`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run db:generate` 输出 no schema changes
- [x] `docker compose config --quiet`
- [x] `bash -n` 全部项目 shell
- [x] `npm run wiki:check`
- [x] `git diff --check`
- [x] `content/` Markdown 字节清单仍为
  `7aea323bcdc27bb0da37a7023d409dd9fd249eb65c8190b54f0ed6e76b698656`

这些自动验收项已全部通过。

## 7. 人工验收结果

- [x] 登录、入口权限与不批准/不发布/不 Merge 警告符合预期。
- [x] 7 个 Diff 文件完整分类为 5 个可导入、2 个冲突或阻止。
- [x] Base / Current / Proposed / Merge 四方材料和段落级三方结果符合预期。
- [x] 安全修改先单独导入，重复 Dry Run 没有产生重复 run 或草稿。
- [x] 自动合并、新文章、重命名和删除提案共创建 5 个草稿/提案；冲突和高风险项未导入。
- [x] 正式文章、旧路径和删除目标未被自动修改，新文章未自动发布。
- [x] 脱敏评论和关闭 PR 均为独立确认的本地 mock 动作，没有 Merge。
- [x] 维护者于 2026-08-01 明确回复“V2 阶段 8 验收通过”。

清理前只读摘要：

```text
runs=1
items=7
drafts=5
formal_revisions=9
external_actions=2
```

`external_actions=2` 分别是只含 Head/数量摘要的本地 mock 评论和关闭动作。正式 Revision
始终保持 9，证明导入没有自动发布。随后 `stop` 已清理人工数据库、三个容器、本地裸 Git
远端、PR fixture、mock state、日志和 `/tmp/vinci-v2-phase8-manual-test`；回环端口
`55452`、`34162`、`34163` 均已释放。没有真实 GitHub、生产数据库、生产凭据、Push、部署
或阶段 9 操作。
