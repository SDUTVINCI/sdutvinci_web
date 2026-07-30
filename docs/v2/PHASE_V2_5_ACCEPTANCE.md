# V2 阶段 5 验收：数据库权威与 DB-first 发布

> 状态：实现、自动验证和维护者浏览器验收均已完成。本文只覆盖阶段 5；没有启动
> Outbox Worker、连接独立内容仓库、Push、部署或进入阶段 6。

## 1. 结论与边界

新闻和 Wiki 的正式权威默认切换为 PostgreSQL 当前 Revision。发布、旧版恢复、删除和
恢复删除不再以 GitHub 成功为前提。成员仍为 `legacy_git`，Nuxt Content、旧
Git-first 服务和仓库 `content/` 均保留。

DB-first 发布的提交边界为：

```text
锁定并验证 approved 草稿与 version
→ 锁定文章并比较 base_revision_id/current_revision_id
→ 构建确定性 Markdown
→ 写成功 publish_record
→ 追加 article_revision 并更新 current_revision_id
→ 写唯一 pending content_export_job
→ 更新草稿为 published 及新 base_revision_id
→ 写审计
→ COMMIT
→ 按 collection + articleId 精确失效进程内缓存
→ 返回成功、Revision 和 waiting_export
```

事务内没有 Git clone/fetch/commit/push、GitHub 请求、文件系统 Markdown 写入或导出
等待。缓存只在提交成功后同步失效；事务失败不会产生缓存所指向的半完成版本。

## 2. 数据库与 Outbox

Migration `0013_charming_iceman.sql` 是 expand-only：

- 新增 `content_export_jobs`；
- 仅给旧删除事件增加可空 Revision/Outbox 外键；
- 仅放宽旧 Git commit 字段的 NOT NULL，字段和旧代码均未删除；
- 无 `DROP TABLE`、`DROP COLUMN` 或破坏性 down migration。

Outbox 至少记录目标类型/ID、Revision ID、`create|update|move|delete|member_update`、
`pending|processing|succeeded|failed`、幂等键、尝试次数、下次尝试时间、最后错误、
导出 Commit 和创建/更新/完成时间。`idempotency_key` 全局唯一；
`(revision_id, operation)` 对非空 Revision 唯一。阶段 5 只创建 `pending` job，
不领取、不导出、不重试；Worker 属于阶段 6。

发布/恢复的 `publish_records.metadata` 同时保存 `revisionId` 和 `exportJobId`。
删除事件以外键保存 source/result Revision 与 export job。只读检查命令：

```bash
DATABASE_URL=<明确的 phase5/test URL> npm run v2:phase5:consistency
```

它检查 current pointer、Revision 序号、当前投影、草稿基线、发布记录、审计和
Outbox 关联，只报告问题，不访问 Git、不修改或自动修复数据。

## 3. 权威与回滚开关

阶段 5 默认：

```dotenv
CONTENT_PUBLISH_MODE=database
CONTENT_SOURCE_NEWS=database
CONTENT_SOURCE_WIKI=database
CONTENT_SOURCE_MEMBERS=legacy_git
CONTENT_CANDIDATE_ENV=production
```

短期完整回滚必须同时设置并重启应用：

```dotenv
CONTENT_PUBLISH_MODE=legacy_git
CONTENT_SOURCE_NEWS=legacy_git
CONTENT_SOURCE_WIKI=legacy_git
CONTENT_SOURCE_MEMBERS=legacy_git
CONTENT_CANDIDATE_ENV=disabled
```

不要只切发布或只切前台。回滚会重新启用旧 Git-first 行为；发布成功再次依赖隔离
worktree 和 Git push，前台再次读取构建内 Nuxt Content。已写入 Revision/Outbox
保留，不做 down migration。若回滚期间产生新 Git 内容，切回 DB-first 前必须冻结
发布、备份并人工制定回填/对账方案；阶段 5 不从 Git 自动覆盖数据库。

## 4. 自动验证记录

自动验证只使用：

- 容器 `vinci-v2-phase5-test-db`；
- 数据库 `vinci_v2_phase5_test`；
- `127.0.0.1:55445`；
- 测试内短暂数据库 `vinci_v2_phase5_test_expand_contract`；
- 明确无效的 Git 地址和临时空目录。

`TEST_DATABASE_URL` 不等于 `DATABASE_URL`。旧 phase2 目录/容器与普通 CMS 容器仅只读
盘点，未复用或修改。自动资源在最终验收记录前会精确删除。

已覆盖：

- 正常事务的 Revision/current pointer/草稿/publish record/审计/Outbox 原子关联；
- `after_revision`、`after_outbox`、删除状态和删除 Outbox 后失败注入完整回滚；
- 无效 Git/GitHub、无 worktree、无内容目录时 DB 发布仍成功；
- 发布响应为 `commitHash: null`、新 Revision、`waiting_export`；
- 数据库前台提交后立即读取新正文；
- 只移除目标文章缓存，保留无关文章缓存；
- 旧 `base_revision_id` 冲突；
- 同草稿并发请求仅一个成功，Revision Number 连续且 Outbox 不重不漏；
- 数据库历史、详情、Diff、恢复追加新 Revision；
- 删除立即下线、恢复立即上线及恢复追加新 Revision；
- `0012` 旧写法在应用 `0013` 前后均可执行；
- 四开关完整回滚及旧 Git-first 总回归；
- 登录、admin、同源、CSRF、UUID/Commit 参数与服务源代码无 Git/文件写入边界；
- 只读一致性报告为 0 issue。

最终命令结果在本阶段本地 Commit 的交接记录与 Codex 最终回复中列出。

## 5. 浏览器优先人工验收

### 5.1 启动隔离资源

前置条件：当前目录是本仓库、Docker 可用、`34160` 和 `55446` 未占用。脚本只创建带
明确标签的 `vinci-v2-phase5-manual-test-db`、数据库
`vinci_v2_phase5_manual_test`、`/tmp/vinci-v2-phase5-manual-test` 和本机 HTTP。
它读取仓库 Markdown 以建立隔离初始 Revision，但不修改 Markdown。

```bash
./scripts/v2-phase5-manual-acceptance.sh start
./scripts/v2-phase5-manual-acceptance.sh admin
```

第二条会在终端安全提示创建首个隔离管理员。不要使用生产账号或密码。然后打开
<http://127.0.0.1:34160/cms/login>。预期可登录；前台新闻/Wiki 和
`/api/v2/content/config` 显示数据库来源。应用配置的 Git 远端是明确无效地址，
`git-must-not-exist` 不应出现。

失败时停止，不改真实 Git 权限；保存当前 URL、截图、浏览器 Console/Network 以及
`/tmp/vinci-v2-phase5-manual-test/application.log`。

### 5.2 发布并立即验证

1. 在后台打开一篇测试 Wiki 或新闻，进入草稿。
2. 做一处容易辨认、仅存在于隔离数据库草稿的修改，提交审核。
3. 使用另一名隔离管理员审核通过并发布。
4. 观察成功提示。
5. 立即在新标签刷新对应前台 URL，再刷新后台文章详情。

预期：前台立即出现新内容；成功提示和详情显示新的 Revision Number/UUID 与“等待导出”；
没有 Commit Hash；发布不因无效 Git 远端失败；后台版本详情的最近导出 Revision 为空或
落后占位。此修改只在人工验收数据库，不写仓库 `content/`。

### 5.3 多人旧基线冲突

在 `/cms/users` 新建第二个隔离管理员，并用两个浏览器 Profile 登录：

1. 两个账号分别在同一文章打开各自草稿，确认两者显示相同 base Revision。
2. 账号 A 编辑并提交；账号 B 审核并发布 A 的草稿。
3. 回到账号 B 先前打开的旧基线草稿，尝试提交或发布。

预期：B 看到 current/base Revision 冲突，旧草稿不能覆盖 A 的新 Revision；同步操作
会明确更新基线，且同步后的内容必须重新审核。不要用 SQL 人工改 current pointer。

### 5.4 历史、Diff、恢复、删除与恢复删除

1. 从文章详情打开“版本历史”，打开发布前后两个 Revision 并查看 Diff。
2. 选择旧 Revision 执行恢复。
3. 刷新历史和前台。
4. 从文章详情删除文章，刷新前台；再执行恢复删除并刷新。

预期：历史只显示数据库 Revision；Diff 对应所选正文；恢复不会移动旧指针或改写旧行，
而是追加更大的 Revision Number 并再次显示“等待导出”；删除后前台 404/不可见，
恢复删除后立即可见且又追加一个 Revision。每个动作都有审计和 pending Outbox。

### 5.5 一致性与 Git-first 回滚

先运行只读检查：

```bash
./scripts/v2-phase5-manual-acceptance.sh consistency
./scripts/v2-phase5-manual-acceptance.sh legacy
```

预期检查为 `issueCount: 0`。第二条只重启本机应用，改用脚本在临时目录创建的隔离 bare
Git 远端；`/api/v2/content/config` 全部显示 `legacy_git + disabled`，历史和发布恢复
旧 Git-first 语义。它绝不连接 GitHub。回到 DB-first：

```bash
./scripts/v2-phase5-manual-acceptance.sh database
```

预期配置恢复 news/wiki database、members legacy。不要在 legacy 模式发布后直接把
Git 变化当作数据库正式内容；那需要后续人工对账，不属于本阶段。

### 5.6 失败证据与精确清理

任何不符合预期时保存：

- 完整 URL、操作账号/时间和前后 Revision UUID；
- 页面截图；
- Console 与失败请求的 Network request/response；
- `application.log`；
- `consistency` JSON；
- 只针对隔离库的 publish record、audit 与 Outbox ID。

最后只运行：

```bash
./scripts/v2-phase5-manual-acceptance.sh stop
./scripts/v2-phase5-manual-acceptance.sh status
```

预期脚本先核对容器标签和临时目录归属标记，再停止 PID、删除精确同名容器和临时目录；
状态显示数据库与 HTTP 均未运行。不得使用 `docker system prune`、宽泛 `rm` 或删除
其他阶段资源。

### 5.7 2026-07-30 人工验收发现：可视化图片 alt 无损保护

首次人工发布在历史 Diff 中发现：Crepe 默认 `ImageBlock` 会把独立 Markdown 图片的
alt 文本当作数值宽高比，导致部分 `![中文图片说明](...)` 在可视化编辑后被序列化为
`![1.00](...)`。数据库 Revision 和 Diff 正确记录了这项真实草稿变化；问题不在
DB-first 事务或历史比较，但正式内容已经出现非预期可访问文本变化，因此本次人工验收
中止，后续恢复、删除和回滚步骤没有继续，也不能据此勾选阶段 5 验收。

修复禁用与 Vinci Markdown alt 语义不兼容的 Crepe `ImageBlock`，继续使用标准
CommonMark 图片节点；可视化初始化的“无损往返检查”同时改为 fail closed：任何
Markdown 语义变化都会保留原文并自动退回源码模式。第一次修复后人工重试发现，Crepe
会合并块之间不影响语义的冗余空行，原先的字符串规范化比较因此误报失败；核对随后改为
比较去除源码位置的 Markdown AST。它允许块间冗余空行和标记风格发生等价变化，但图片
alt、链接、正文、代码块内空行等实质节点或值发生变化仍会失败关闭。

回归测试覆盖中文图片说明被替换为 `1.00`、块间冗余空行等价和代码块内空行丢失；
真实无头 Chrome 对完整测试文章往返后判定语义一致，且所有中文图片说明原样保留。

修复后必须精确重建人工验收数据库，从干净 Revision #1 重新执行发布、旧基线、历史、
Diff、恢复、删除、恢复删除、回滚和一致性检查。旧失败数据库只在修复取证完成前保留，
不得继续作为通过样本；阶段 5 人工验收项仍全部未勾选。

### 5.8 2026-07-30 维护者重新验收与最终清理

修复提交后，人工验收环境从干净 Revision #1 精确重建。维护者重新完成发布和立即刷新、
无效 Git 远端、当前 Revision/等待导出、多人旧基线冲突、历史/Diff/恢复、删除/恢复
删除，以及完整 `legacy_git + disabled` 回滚和切回
`database + production` 的浏览器验收，并确认全部通过。重新验收没有再出现
`![1.00]` 或可视化无损往返误报。

最终只读一致性报告：

```json
{
  "counts": {
    "articles": 228,
    "revisions": 231,
    "databaseOperations": 3,
    "outboxJobs": 4,
    "deletionEvents": 2
  },
  "issueCount": 0,
  "issues": []
}
```

切回后 `/api/v2/content/config` 为
`production / news=database / wiki=database / members=legacy_git`，健康检查中应用与
数据库均正常。最终检查确认代码仓库 `content/` 无改动。`stop` 在核对归属标记后精确
删除 `vinci-v2-phase5-manual-test-db` 和
`/tmp/vinci-v2-phase5-manual-test` 并停止 34160；随后 `status` 与独立复查均确认
数据库、HTTP、容器和临时目录无残留。

维护者确认时间：2026-07-30。确认原文：`V2 阶段 5 验收通过。`

## 6. 人工验收清单

- [x] 我在隔离浏览器环境发布文章并立即刷新数据库前台，确认内容生效。
- [x] 我确认无效测试 Git 远端下发布仍成功。
- [x] 我确认后台显示当前 Revision 和“等待导出”。
- [x] 我测试多人旧 `base_revision_id` 冲突。
- [x] 我查看历史、详情、Diff，并确认恢复追加新 Revision。
- [x] 我测试删除与恢复删除。
- [x] 我测试四开关 Git-first 回滚和重新切回数据库。
- [x] 我保存失败证据或确认 `issueCount: 0`，并精确清理资源。
- [x] 我明确回复“V2 阶段 5 验收通过”。

## 7. 阶段结论与 Commit

- [x] V2 阶段 5 实现、自动验证和维护者人工验收全部完成。
- [x] 阶段 5 人工验收资源已精确清理。
- [x] 允许在新的独立任务中开始 V2 阶段 6。
- 阶段 5 实现 Commit：`86c034cb91231053affcf860765540d3ced50c8b`。
- 可视化图片 alt 修复 Commit：`a523cbb`。
- Markdown 语义往返修复 Commit：`8bf1067`。
- 验收记录 Commit：由最终回复报告，不在 Commit 内预填自身 SHA。
- 以上提交均未 Push、未部署；本轮没有进入阶段 6。
