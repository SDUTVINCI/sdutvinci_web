# V2 阶段 9：成员资料数据库权威与提案导入验收

日期：2026-08-01
状态：维护者人工验收通过，已正式收尾
前置基线：阶段 8 验收记录 `a087ba8139622f875db1b1d4042f50920ed95a49`

## 1. 本阶段结论边界

- PostgreSQL 是成员资料正式权威；CMS 与公开团队详情不再隐式读取或先写 Markdown。
- 32 份既有成员文件通过显式一次性命令迁移，稳定 `member_key` 和已有 member UUID 保留。
- `member_revisions` 不可变；所有 CMS 修改、恢复和接受提案都创建新 Revision、审计与 Outbox。
- 账号绑定只存在于 `user_members`，不进入 profile、Revision、导出或 PR 白名单。
- 成员 Markdown 确定性导出到独立内容仓库 `members/`，进入 snapshot/manifest、Worker、对账与恢复。
- 成员 PR 导入只创建 `member_proposals`；必须在成员页再次明确接受。删除也不会自动生效。
- 登录账号/密码、系统角色/权限、绑定与安全字段递归拒绝；内网头像/链接和路径逃逸 fail closed。
- Nuxt Content 与代码仓库 `content/members` 未删除；没有 Push、部署、真实 GitHub 写入或阶段 10 工作。

## 2. 自动验证证据

隔离 PostgreSQL 17 数据库名包含 `test`，普通 `DATABASE_URL` 从测试命令移除。阶段 9 专项
覆盖 32 份资料、幂等迁移、Revision/Outbox、DB 公开读取、乐观锁、恢复、账号绑定、确定性
序列化、字段级合并、成员 PR 安全/自动合并/冲突/敏感拒绝/删除提案、明确接受与幂等。

最终交付检查结果：阶段 9 专项 5 files / 35 tests、完整 CMS 15 files / 108 tests、完整
`npm test` 18 files / 123 tests 均通过；typecheck、production build、0000→0017 fresh
Migration、no-change generate、Compose config、phase 0 content audit、226 篇 wiki check、shell
syntax 与 `git diff --check` 也全部通过。复现命令：

```bash
TEST_DATABASE_URL='<isolated-test-url>' npm run test:v2:phase9
TEST_DATABASE_URL='<isolated-test-url>' npm run test:cms
npm run typecheck
npm run build
npm run v2:phase0:audit
npm run wiki:check
git diff --check
```

迁移 CLI 默认为 Dry Run；实际写入必须同时提供两个参数：

```bash
npm run v2:members:migrate -- --dry-run
npm run v2:members:migrate -- --apply --confirm=MIGRATE_MEMBER_PROFILES
```

## 3. 一键准备隔离人工环境

```bash
npm run v2:phase9:manual -- start
```

完成后访问 `http://127.0.0.1:34172/cms/login`：

- 账号：`phase9admin`
- 密码：`Phase9Manual123!`

脚本建立 32 名正式成员、本地裸 Git 内容仓库和 mock GitHub PR #9。PR 包含安全修改、
不同字段自动合并、同字段冲突、敏感字段拒绝和删除提案五项；启动时 0 个正式成员提案。
所有容器带 `com.sdutvinci.scope=v2-phase9-manual-test`，只使用回环端口与
`/tmp/vinci-v2-phase9-manual-test` marker。

另有 `http://127.0.0.1:34174/team` 以 `CONTENT_SOURCE_MEMBERS=legacy_git` 启动，只用于
与 34172 的数据库权威页面并排核对回退开关；它不开放导入，也不写 PostgreSQL。源码和
构建产物保持只读，Nuxt Content 运行时 SQLite 只写入阶段 9 临时目录。启动健康检查必须
实际读到 `wangziming`，空列表或详情 404 会直接拒绝启动。

## 4. 维护者一次性浏览器验收

1. 登录后进入“成员”，确认显示 32 名且页面说明 PostgreSQL 权威。
2. 抽查教师、2018、2022～2026 成员；再打开公开 `/team` 和一条成员详情，核对姓名、头像、
   届次、指导届次、职责、链接和正文。
3. 打开 PR 未涉及的 `wangziming`，修改一个公开字段并保存；无需构建/部署，刷新
   `http://127.0.0.1:34172/team/wangziming` 应立即变化。同时刷新
   `http://127.0.0.1:34174/team/wangziming`，应仍显示 Git 基线值，证明回退开关独立有效。
   隔离导出 Worker 最多约 2 秒后会把新 Revision 确定性导出到本地内容仓库。
4. 核对版本从 v1 增加，版本历史有 SHA；恢复旧版本后应创建更高的新版本，不覆盖历史。
5. 在账号绑定面板绑定/解绑 `phase9admin`，确认资料版本不增加、公开 Markdown 字段不出现账号。
6. 进入“外部内容导入”，仓库保持 `SDUTVINCI/sdutvinci_content`，PR 填 `9`，执行完整
   Dry Run。预期依次看到成员安全修改、成员字段级自动合并、成员字段冲突、成员敏感字段已
   拒绝、成员删除提案；可导入 3、阻止 2，正式成员没有变化。
7. 分别点每项“查看 Base（分支起点）/ Current（数据库当前）/ Proposed（PR 提议）/ Merge
   （合并结果）”，材料应在当前文件卡片内联展开。冲突项显示同字段，敏感项只显示拒绝码且
   Proposed 为“无”；账号、permissions 不应回显。
8. 只导入预选 3 项。预期创建 3 个成员提案、0 个文章草稿，`dongjiahui` 正式姓名与 `likun`
   公开详情仍不变/仍存在。不要点击评论或关闭，除非要验收本地 mock 外部动作；绝无 Merge。
9. 打开 `dongjiahui`，核对待接受名称提案。点击“明确接受提案”并二次确认后，才应创建新
   Revision 并改变正式资料。`likun` 删除提案不要接受，以证明删除文件不会自动删除成员。
10. 不需要也不要连接真实 GitHub；全部 PR API、评论和关闭都只指向回环 mock。
11. 运行 `npm run v2:phase9:manual -- inspect`，记录 members、Revision、PR run/item、
   pending proposal、member Outbox、binding、内容仓库成员文件和 snapshot members 数量；
   后两项应均为 32，`member_export_jobs_succeeded` 应等于全部 member jobs，且
   `repository_matches_database=yes`。

## 5. 异常时保留证据

不要立即清理。保留成员 UUID/key/version/current Revision、proposal ID/status/field changes、
Outbox job、audit action、浏览器请求状态和隔离容器日志。不得粘贴数据库 URL、密码、Cookie、
CSRF、Token、私钥或完整环境变量。修复后只在同一隔离环境重演相关步骤。

## 6. 清理与回滚

人工验收完成后：

```bash
npm run v2:phase9:manual -- inspect
npm run v2:phase9:manual -- stop
```

脚本会先核对 label 和 marker，再精确删除五个阶段 9 容器与临时目录。应用回滚只用普通
`git revert <阶段9实现Commit>`；保留 expand-only `0017`、Revision、Proposal、Outbox 与审计，
不执行 down migration。公开读取可临时显式切回 `CONTENT_SOURCE_MEMBERS=legacy_git`。

## 7. 验收结论

维护者于 2026-08-02 明确回复“V2 阶段 9 验收通过”。最终只读状态为 32 members、37
member revisions、1 PR run、5 PR items、2 pending proposals、37/37 member export jobs
succeeded、0 bindings、32 repository member files、32 snapshot members，且
`legacy_member_links=32`、`repository_matches_database=yes`。另有 1 条经维护者明确授权的
本地 mock PR 评论；PR 保持 open，没有关闭、Merge 或真实 GitHub 写入。阶段 9 总体进度和
人工验收项已据维护者结论勾选；验收记录 Commit 后精确清理人工环境，不进入阶段 10。
