# V2 阶段 7：凌晨 3 点全量对账、初始化和灾难恢复——实施与验收

## 1. 当前状态

- 实现状态：完成。
- 自动化验证状态：完成，全部通过。
- 人工验收状态：维护者已于 2026-08-01 明确验收通过。
- 是否允许进入下一阶段：本阶段已正式收尾；本次未 Push、未部署、未进入阶段 8。

## 2. 本阶段范围

本阶段只实现 PostgreSQL 到内容仓库的每日全量对账、严格空库 Markdown 初始化、独立
灾难恢复、自动数据库/配置清单备份、分层保留和安全清理。没有实现普通 PR 修改导入，
没有让 GitHub 差异反向修改非空数据库，没有删除代码仓库 `content/`。

## 3. 实现内容

### 3.1 全量对账

- `Asia/Shanghai` 每日 03:00 systemd timer 定义；
- 与阶段 6 Worker/接管共用 PostgreSQL session advisory lock；
- 从数据库 current Revision 生成带精确归属标记的完整快照；
- 比较数据库新增、仓库缺失、字节修改、多余文件、snapshot 和 manifest；
- 生成带双方 SHA-256、base/result Commit、差异分类和 report SHA 的脱敏 JSON；
- 无差异只写 run/report，不 Commit；有差异生成一个普通非强制修正 Commit；
- CMS 工作台显示最近运行时间、状态、差异数和结果 Commit。

### 3.2 初始化和灾难恢复

- 独立 `v2:content:recover` CLI、`content-recovery` Compose profile 和受控编排脚本；
- 默认 disabled，普通应用启动绝不导入；
- 严格检查全部业务表为空（仅允许固定角色种子）、format/layout/serializer version 1、
  UUID、路径、bytes、SHA-256、snapshot/manifest、确定性序列化和 member reference；
- 拒绝 manifest 外受管 Markdown，以及 active/tombstone 间的 ID、路径冲突和重复项；
- 令牌绑定 mode、snapshot hash、report hash 和 item count；
- member/article/Revision/current pointer/import item/import run/audit 单事务写入；
- 事务失败零半成品；非空数据库拒绝；
- disaster 模式和未来普通 PR 导入没有共享 API 或权限；
- 编排在导入后再次运行向前 Migration、pointer/hash 完整性和本机健康检查。

### 3.3 备份、保留和清理

- V2 backup manifest、自动配置状态清单、SHA-256 和 `pg_restore --list`；
- 操作互斥锁、可配置重试、磁盘 warning/critical 阈值；
- latest-success JSON 和脱敏 alerts JSONL；
- 完整性 marker 与隔离验证可恢复 marker 分离；
- 每日 7 天、每周 4 周、每月 12 月的可配置分层保留；
- 始终保护最新成功、最近验证可恢复、维护者锁定备份；
- 新备份失败不推进成功门禁、不删除旧备份；
- PostgreSQL 包/配置清单、内容快照、对账报告和临时目录安全清理及 Dry Run；
- 路径越界、根目录、未知目录、符号链接、特殊文件、错误 UID 和缺失归属标记均拒绝；
- cleanup 失败与备份、对账、发布、网站运行解耦。

## 4. 主要修改文件

- Schema/Migration：`server/db/schema.ts`、`0015_chubby_scorpion.sql` 和 snapshot/journal；
- 对账：`content-reconciliation.ts`、CLI、Compose profile、systemd service/timer；
- 恢复：`content-recovery.ts`、独立 CLI/profile、完整性检查和灾难恢复编排；
- CMS：dashboard service/type/page；
- 备份清理：`backup.sh`、`restore.sh`、verify/mark/prune/maintenance cleanup；
- 测试：阶段 7 数据库/Git 集成、运维安全集成、扩展后的 backup/restore 和 CMS 回归；
- 文档：需求、架构、部署、本手册、备份恢复手册和追加式交接记录。

没有修改 `content/**/*.md`。

## 5. 数据库变更

Migration `0015_chubby_scorpion.sql` 是 expand-only，新增：

- `content_reconciliation_runs`；
- `content_import_runs`；
- `content_import_items`。

只新增表、check/index/FK，不删除或重命名旧表/列，不执行 down migration。初始化显式
插入 snapshot 的 article/revision UUID；普通发布事务保持阶段 5/6 逻辑。

## 6. API 和界面变更

- 既有 `GET /api/cms/dashboard` 增加安全的 `reconciliation` 摘要；
- CMS 工作台新增“最近全量对账”卡片；
- 没有新增浏览器写 API；初始化和灾难恢复只在 operations CLI。

## 7. 依赖和环境变量

没有新增 npm 依赖。新增运维配置：

- `CONTENT_RECONCILIATION_ROOT`；
- `CONTENT_RECOVERY_MODE`；
- `BACKUP_RETRY_ATTEMPTS`、`BACKUP_RETRY_DELAY_SECONDS`；
- `BACKUP_MIN_FREE_BYTES`、`BACKUP_CRITICAL_FREE_BYTES`；
- 三层备份保留和 snapshot/report/tmp 保留天数；
- apply 时的一次性确认变量，不写入仓库。

测试专用 `CONTENT_RECOVERY_TEST_MODE` 和事务失败注入只在
`NODE_ENV=test` 有效，production 测试模式 fail closed。

## 8. 架构和安全决定

- 全量对账只执行数据库到 Git，永不反向修改数据库；
- 正常迁移继续依赖 PostgreSQL 备份，Markdown 仅为受控灾难材料；
- 恢复非空库不提供 override；
- snapshot tombstone 没有历史正文，因此不能伪装恢复完整删除历史；
- 配置清单不保存密钥值，S3/COS 二进制仍需独立版本控制/备份；
- timer 文件只是项目部署定义，本阶段没有安装或修改宿主机定时任务；
- 报告、状态和 CMS 不返回原始凭据、私钥路径或 Git stderr；
- 所有自动清理目标都需精确根、名称、UID、marker 和非 symlink。

## 9. 自动化验证结果

最终结果：

- `npm run test:v2:phase7`：1 个数据库/Git文件 5/5，通过；运维安全 shell 通过；
- `npm run test:cms`：14 文件 95/95，通过；
- `npm run test:backup-restore`：通过；真实 custom dump、两次失败后第三次成功重试、
  checksum、空库 restore、后置 Migration、应用健康和非空拒绝均通过；
- `npm test`：4 文件 17/17 通过；11 文件 85 项数据库测试在无
  `TEST_DATABASE_URL` 的普通模式按设计跳过；
- `npm run v2:phase0:audit`：通过；260 个 Markdown、0 symlink，字节清单 SHA-256
  `db36a4ef8c696d95662d5e1cac6c5fd5792ae02610ed6e5aab36d25ef1fe5ede`；
- `npm run wiki:check`：通过；226 个文件的 order、URL 和站内链接正常；
- `npm run typecheck`：通过；
- `npm run build`：通过；4 collections、260 files；只有既有静态图片解析和 chunk
  size warning；
- 基础、内容导出/对账/恢复 Compose config：使用 `.env.example` 严格通过；
- `npm audit`、`npm audit --omit=dev`：均为 0 vulnerabilities；
- systemd unit 语法及 02:00/03:00/04:00 Shanghai calendar：通过；
- 全部 shell `bash -n`：通过；
- `git diff --check`：通过。

测试资源：

- 阶段 7 DB：`vinci-v2-phase7-test-db` /
  `vinci_v2_phase7_test` / `127.0.0.1:55449`；
- Git、workspace、snapshot、report、backup root 和临时目录均位于带
  `phase7-test` 标记的 `mktemp` 根；
- backup/restore 使用动态隔离 Compose project、独立数据库/volume/端口；
- 最终运维错误属主测试使用带 `vinci.test.owner=v2-phase7` 标签的瞬时容器；
- 未使用生产数据库、生产 Git 凭据、真实内容仓库写权限、真实备份存储或部署环境。

## 10. 覆盖矩阵

| 要求 | 自动证据 |
| --- | --- |
| Shanghai 03:00 | timer 精确表达式测试 |
| 无差异无 Commit | 远端 HEAD 不变、run/report 成功 |
| 篡改/新增/缺失/多余 | 分类报告、普通父子修正 Commit、最终文件一致 |
| snapshot/manifest | metadata hash 比较与修正 |
| Worker 互斥 | 同 advisory lock busy 测试 |
| CMS 最近结果 | dashboard service/type/UI 回归 |
| 非空、格式、哈希、令牌 | 全部 fail-closed 集成测试 |
| 事务失败 | 注入第一项后回滚，article/import/audit 均 0 |
| 隔离恢复 | apply、后置 Migration/完整性/健康编排和 backup restore 演练 |
| 自动备份/重试/校验 | 互斥、磁盘、2 次失败后第 3 次成功、checksum、状态/告警 |
| 分层保留 | Dry Run 与实际删除结果一致 |
| 三类保护 | latest/verified/locked 均保留 |
| 新备份失败保护 | success gate 不更新，prune 拒绝 |
| 过期资产 | backup/snapshot/report/tmp 精确删除 |
| 路径/symlink/owner | 越界、顶层/嵌套 symlink 和不同 EUID 拒绝 |

## 11. 已知限制

- 阶段 7 没有安装宿主机 timer；阶段 11 才提供统一安装入口。
- 自动配置备份是“设置状态清单”，真实 `.env` 和密钥仍需维护者的独立加密方案。
- “最近验证可恢复”必须在隔离恢复、Migration 和健康检查后人工精确标记，系统不会用
  仅 `pg_restore --list` 的结果冒充可恢复性。
- Markdown 快照不能恢复用户、草稿、审核、会话、完整 Revision 历史和 S3 图片。
- 阶段 8 普通 PR 导入尚未实现。

## 12. 回滚方法

1. 停用对账/备份/cleanup timer 或 profile，保留日志、run、报告和旧备份；
2. 对代码创建普通 `git revert <阶段7实现Commit>`；
3. 不 down Migration `0015`，新表留存不影响旧槽位；
4. 不删除 Outbox、Revision、内容仓库历史或代码仓库 `content/`；
5. 内容仓库错误修正只在数据库/报告审计后普通 `git revert`，禁止 Force Push。

## 13. 人工验收准备

维护者无需提供真实 GitHub 权限。Codex 将准备：

- `vinci-v2-phase7-manual-test-db` 和名称含 test 的数据库；
- 本地裸 Git 远端、独立 workspace、snapshot/report/backup/tmp 根；
- 回环 CMS 端口；
- 隔离管理员和浏览器 URL；
- 只用于本轮的故障注入、恢复和精确清理。

维护者只需：

- 使用浏览器登录；
- 在指定步骤确认 CMS 状态和截图；
- 在空库初始化 apply 前把 Codex 输出的完整确认令牌原样回复；
- 最后明确回复是否通过。

## 14. 一次性浏览器优先人工验收步骤

1. 打开 Codex 提供的 `/cms/login`，登录隔离管理员。
   - 预期：进入 CMS 工作台；“最近全量对账”初始为尚未运行或测试准备状态。
   - 异常证据：完整 URL、截图、Console 和登录 Network。
2. 通知 Codex运行无差异全量对账，然后只刷新工作台。
   - 预期：显示成功、上海时间、0 项差异和结果 Commit；远端无新 Commit。
   - 异常证据：卡片截图、run ID、对账 JSON、对账前后 HEAD。
3. 通知 Codex在本地测试远端分别制造篡改、缺失和多余文件，并在数据库新增一篇测试文。
   - 预期：Codex触发后工作台显示成功及非零差异；普通修正 Commit 的父提交是故障
     HEAD，文件恢复数据库版本，新增出现、缺失恢复、多余删除。
   - 异常证据：卡片、report、`git show --stat`、四类路径和双方 SHA。
4. 通知 Codex持有增量 Worker lock 后触发对账。
   - 预期：显示互斥跳过，不写远端；释放后重跑成功。
   - 异常证据：busy run、lock 查询和前后 HEAD。
5. Codex对空隔离数据库执行 initialize Dry Run，并一次性发完整摘要和确认令牌。
   - 操作：核对 mode、snapshot/report SHA、文章/成员数后，把完整令牌原样回复。
   - 预期：令牌错误时拒绝；正确令牌时一次事务导入，CMS/前台内容可读。
   - 异常证据：Dry Run JSON、令牌错误文本、事务 run/item/audit 计数、页面截图。
6. Codex对已导入的非空库再次尝试 Dry Run。
   - 预期：明确 `DATABASE_NOT_EMPTY`，既有内容不变。
   - 异常证据：拒绝日志和导入前后计数/哈希。
7. Codex用新的空隔离库执行 disaster recovery、后置 Migration、完整性和健康检查。
   - 预期：所有检查通过；故障注入时零半成品，修复后从新空库重演成功。
   - 异常证据：Migration 输出、integrity JSON、health 响应和故障库计数。
8. 浏览器回到 CMS 工作台，核对最近对账状态；Codex展示备份状态、alerts 和保留 Dry
   Run 摘要。
   - 预期：latest success 存在；失败备份不改变它；latest/verified/locked 在 deleted
     清单中均不存在；磁盘阈值提示清楚。
   - 异常证据：工作台、state/alerts、Dry Run JSON 和目录清单。
9. Codex执行正式测试清理，再给出只读 status。
   - 预期：只删除本轮容器、数据库/volume、本地远端、workspace、端口、日志和临时根；
     代码仓库 `content/` tree 不变，原 `vinci-cms-postgres` 不受影响。
   - 异常证据：停止清理，保存容器 label、路径 marker、PID/端口和 Git status。
10. 全部接受后明确回复“V2 阶段 7 验收通过”。

任何一步不符合预期都立即停止并保留证据。先修复，再重跑受影响专项、完整 CMS、
typecheck 和 build；不得勉强判定通过。

## 15. 人工验收记录

- 验收结论：通过。
- 维护者确认时间：2026-08-01 21:09:27 CST（+08:00）。
- 实现 Commit：`45f4a5934d4dac9bfeb55ff406fed016d714b97b`。
- 验收修复 Commit：无；人工验收未发现产品缺陷。
- 维护者确认原文：`V2 阶段 7 验收通过`。

人工验收证据：

- 初始 CMS 状态、无差异对账、四类差异修正、锁占用跳过及锁释放后重跑均由维护者
  浏览器确认正常；无差异 HEAD 保持 `d26b4fa00fce6d11c119197a152aebfd251a1260`，
  四类差异由普通子 Commit `79da63982905efa5256989ac00f0ba3da098e36f` 修正；
- initialize 使用独立空库，错误令牌拒绝，事务故障注入后 article/revision/import/audit
  均为 0；正确令牌导入 229 篇文章和 32 名成员，pointer/hash 完整性问题均为 0，
  再次对非空库 Dry Run 明确拒绝；
- disaster recovery 使用另一独立空库和独立 mode 令牌，initialize 令牌不能跨 mode 使用；
  恢复 229 篇文章和 32 名成员后，向前 Migration、完整性及应用健康检查均通过；
- 运维复验覆盖 Shanghai 调度、备份互斥、两次失败后第三次成功、完整性、状态/告警、
  保留 Dry Run、失败备份保护、latest/verified/locked 保护、过期资产、安全路径及磁盘阈值；
- 恢复页面首次检查使用了不符合 production 约束的测试环境组合
  `CONTENT_SOURCE_MEMBERS=database`，导致成员页面 404；数据库记录和 API 同时保持正常。
  将隔离应用改回允许的 `legacy_git` 成员来源后页面正常，确认属于人工测试环境配置，
  未修改产品代码；
- 维护者最终确认“运维与最终工作台正常”。人工容器、数据库、裸 Git 远端、workspace、
  日志、备份/快照/报告/临时根和端口均按名称、标签及归属标记精确清理；既有
  `vinci-cms-postgres`、代码仓库 `content/` 和全部既有本地提交未受影响。

## 16. 下一阶段注意事项

- 维护者已明确“V2 阶段 7 验收通过”；本次仍未开始阶段 8，阶段 8 须另行授权启动。
- 阶段 8 只能按 PR Diff 创建草稿/提案，不能复用 disaster 全量入口覆盖数据库。
- 保留 `0015` 表、对账报告和备份状态供后续审计。
- 未 Push、未部署；真实内容仓库 HEAD 未写入。
