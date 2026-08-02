# V2 阶段 11：统一运维入口、安全复验与最终验收——实施与验收

## 1. 当前状态

- 实现状态：27.2 和 27.3 已实现。
- 自动化验证状态：27.4 已通过；命令与隔离边界见第 9 节。
- 人工验收状态：维护者已完成隔离验收并给出完整最终确认语，27.5 已勾选。
- 是否允许宣布 V2.0 完成：是。阶段 0～11 的实现、自动验证和人工验收均已正式收尾。

## 2. 本阶段范围

本阶段只统一现有安装、更新、状态、doctor、备份/校验/保留、恢复、实例迁移、对账、健康与
清理入口，替换生效代码和 unit 的固定用户/路径，并复验 V2.0 安全与灾备边界。没有进入新
业务阶段，没有重新引入 Nuxt Content 或代码仓库正式 `content/`，也没有修改 Wiki 拼音模块。

## 3. 实现内容

- 根入口 `./vinci` 解析 NSS 当前用户、UID、GID、主组、Home 和 Shell；Dry Run 不写安装状态。
- 动态渲染五组 service/timer 与 logrotate；新服务器和不同用户重新生成，不复制旧 Home。
- 兼容包装仅转发统一入口；旧用户迁移要求已验证备份、精确确认、无锁、无 symlink/特殊文件，
  使用 `find -xdev -user` 精确修属主，替换 unit，但永不自动 `userdel`。
- 备份/恢复复用现有校验、空库门禁、`pg_restore` 和向前 Migration；实例包增加数据库、Git
  bundle/Commit、镜像/槽位、内容仓库/对象存储说明、SHA 和无密钥清单。
- doctor 检查数据库指针、导出/对账/PR 状态、S3/COS Bucket 和全部媒体对象、公开 URL、磁盘、
  Compose、gateway、活动槽和 timer；缺失对象只输出 key 哈希。
- 清理覆盖分层备份、对账 snapshot/report/tmp、迁移包、日志、Docker 镜像和 build cache；
  `.deploy/rollback-verified` 永久保护上一健康版本，不受最近镜像数量限制。
- 当前短手册与十份详细教程已统一；V1 和阶段 0 记录只加历史基线提示，没有删除或改写历史。

## 4. 修改文件

- 统一入口与安全脚本：`vinci`、`scripts/ops-common.sh`、`scripts/deploy.sh`、
  `scripts/instance-*.{sh,mjs}`、`scripts/v2-operations-doctor.ts`、兼容安装/备份/清理脚本。
- 运行服务：`server/services/operations-doctor.ts`、`compose.yaml`、`.env.example`。
- 调度：`systemd/vinci-cms-*`、新增 health service/timer 与 `vinci-cms.logrotate`。
- 自动化：`.github/workflows/deploy.yml`、阶段 11 专项/全量/systemd/Markdown/doctor/迁移夹具，
  以及扩展后的备份恢复和蓝绿测试。
- 文档：`docs/DEPLOYMENT.md`、`docs/ARCHITECTURE.md`、`docs/v2/OPERATIONS.md`、
  `BACKUP_AND_RECOVERY.md`、`PR_IMPORT.md`、V1 历史提示和本文件。

## 5. 数据库变更

没有 schema 或数据 Migration。doctor 只读现有 28 张表；`drizzle-kit generate` 确认无变化。

## 6. API 变更

没有新增 HTTP API。新增本机 CLI 子命令和只在 `tools` profile 中运行的只读
`operations-doctor` 容器；浏览器权限、CSRF、审核、发布和限流接口不变。

## 7. 依赖和环境变量

没有新增 npm 依赖。主机前置增加 Node.js 24、systemd-analyze 和 logrotate 的明确检查。

- `S3_DOCTOR_MAX_OBJECTS`：一次完整对象检查的 fail-closed 上限，默认 10000。
- `INSTANCE_EXPORT_ROOT`：无密钥实例包根，默认 `/var/backups/vinci-cms-instances`。
- `INSTANCE_RETENTION_DAYS`：实例包保留天数，默认 30。
- `VINCI_LOG_ROOT`：当前安装用户拥有的日志根；按日/30 份/100 MiB 轮转。

## 8. 架构决定

唯一宿主运维入口是当前用户执行的 `./vinci`；systemd root-owned 配置与运行身份分离。数据库仍
是内容权威，独立内容仓库仍是确定性快照，S3/COS 仍是二进制权威。实例迁移包故意不包含
`.env`、Token、私钥或 S3 二进制；三类灾备分别恢复后才切流量。部署继续使用完整 SHA、
expand/contract Migration、app-blue/app-green 和 gateway graceful reload。

## 9. 自动化验证结果

全部命令在 2026-08-02 本机隔离资源中执行。Compose project、容器、网络、volume、镜像、目录
和数据库名均含 `test`；新夹具使用 `cn.vinci.test=true` 与精确 scope label，端口只绑定
`127.0.0.1`，凭据均为明确 test 值。

| 命令 | 结果 |
| --- | --- |
| `npm run test:v2:phase11` | 通过：doctor/security/阶段10 共 12 项，历史 Markdown/XSS 4 项与 226 个 Wiki 文件，以及 CLI、不同 UID/GID/Home、旧用户迁移、systemd/logrotate、保留/清理/自动部署专项。 |
| `tests/v2-phase11-full.integration.sh` | 通过：全新 PostgreSQL 运行全部 Migration；`npm test` 20 文件 132 项通过，并复跑完整 CMS 与阶段 10 套件。 |
| `npm run test:backup-restore` | 通过：custom dump/SHA、失败门禁、空库恢复、非空拒绝、可恢复 marker、实例导出/新服务器导入、向前 Migration、健康/S3 doctor、真实本地镜像蓝绿成功与失败候选回滚。 |
| `npm run typecheck` | 通过。 |
| `npm run build` | production build 通过；runtime 镜像验证不含正式 Markdown。 |
| `npm run db:generate` | 28 张表，无 schema changes。 |
| `npm audit` / `npm audit --omit=dev` | 均为 `found 0 vulnerabilities`。 |
| `npm run wiki:check`（删除前 tag 所指固定 Commit 的测试快照） | 226 个 Wiki 文件通过；拼音 URL/order/链接正常。 |
| `docker compose config --quiet` 与三份 test override | 通过；S3 替身精确发布到回环 test 端口。 |
| `systemd-analyze verify` / `logrotate --debug` | 当前真实用户渲染结果通过，无未解析占位或固定身份。 |
| 全部 shell `bash -n`、`git diff --check`、固定身份/Force Push/生产目标静态审计 | 通过。 |
| 验收后 GitHub Actions 快照修复 | 完整历史和删除前固定 Commit 可用，不依赖远端 tag；runner test 根提取并校验 260 个 Markdown；CMS 109/109、完整测试 132/132、阶段 10 为 33/33、阶段 11 为 12/12+4/4+Wiki 226，typecheck/build/diff 通过；失败路径也按 marker 清理。 |

测试没有连接生产 PostgreSQL、生产 S3/COS、生产 Git、真实 GitHub 写接口或生产服务器。本地
bare remote 的普通 Push 只用于蓝绿测试，测试结束按精确 marker/label 清理。

## 10. 安全检查

- 权限、CSRF、角色、会话摘要、登录/上传限流、非空恢复、确认令牌和路径/owner/symlink/
  特殊文件 fail-closed 回归通过。
- 删除前 228 个新闻/Wiki Markdown 的可视化预处理和 XSS/原始 HTML 风险回归通过；正式代码
  不恢复这些文件，也不恢复 `@nuxt/content`。
- Git 内容导出只允许普通 fast-forward Commit；脚本无 Force Push、自动 Merge 或生产写入口。
- 日志、doctor、实例清单只保留状态/计数/哈希；真实密钥没有进入输出、迁移包或 Git。

## 11. 已知限制与生产部署前检查清单

已知限制：S3 完整检查默认最多 10000 条，超限会拒绝而非抽样；实例包不搬运 S3 二进制、内容
仓库远端或秘密；旧账号必须由管理员在观察完整 timer 周期后人工删除；内容 snapshot 最后手段
仍不能恢复用户、草稿、全部 Revision、审核和审计。

生产部署前必须逐项确认，当前均未授权执行：

- [x] 维护者已完成第 14 节人工验收并给出完整最终确认语。
- [ ] 已在独立密码库配置生产 `.env`/Git/S3 凭据，文件为 0600，未进入命令历史。
- [ ] 生产数据库、内容仓库、S3/COS 三类备份均完成并有近期隔离可恢复记录。
- [ ] 当前和回滚完整 SHA 的 runtime/operations 镜像均存在，Migration 为 expand/contract。
- [ ] `./vinci install --dry-run`、维护窗口、DNS/代理回滚和旧服务器保留窗口已复核。
- [ ] 生产变更另行明确授权；本阶段 Commit 本身不 Push、不部署。

后续计划只限日常依赖更新、容量阈值调优和演练；它们不是新的 V2 实施阶段。

## 12. 回滚方法

本阶段无数据库 Migration。代码回滚使用普通 `git revert <阶段11实现Commit>` 产生新 Commit，
不 reset/rebase/amend。切流量失败时保持当前健康槽和 `.deploy/rollback-verified` 镜像；不要删除
volume。回退代码前保存新 unit 和安装清单，并继续使用当前用户身份，不能重新启用历史固定
用户。实例导入失败从新空库重演；旧服务器、已验证备份和锁定迁移包保留到验收结束。

## 13. 人工验收准备

Codex 使用 `scripts/v2-phase11-manual-acceptance.sh` 在固定的
`/tmp/vinci-phase11-manual-acceptance-test` 准备并管理隔离环境。它使用当前登录用户、test
project/database/凭据、精确 label/marker 和回环端口，内部完成动态 systemd Dry Run、Migration、
app/gateway/S3 替身、doctor 和备份校验。真实数据库 URL、Token、私钥和清理命令不交给维护者。

## 14. 人工验收步骤

只需在本仓库根目录执行一个安全命令：

```bash
./scripts/v2-phase11-manual-acceptance.sh verify
```

预期出现三行 `PASS`，分别确认当前用户运维、隔离资源边界和最终自动验收摘要。命令只新增一份
隔离 test 备份，不清空数据库、不删除资源、不连接生产。若不是三行 PASS，请只回报失败行；
不要复制环境文件或日志中的敏感值。隔离环境由 Codex 在最终确认后精确清理。

执行结果：维护者已取得三行 `PASS`。收到完整确认语后，Codex 已按归属 marker 精确删除该
test project、数据库 volume、网络、验收镜像和固定 `/tmp` 根，回环端口 48211/48212 已释放。
隔离测试数据库不可恢复；生产资源未在清理目标中。

## 15. 人工验收预期结果

- 当前登录用户的 UID/GID/Home 被识别，动态 unit 无固定用户/路径。
- status/doctor、备份与完整性校验通过；数据库、应用、gateway 和 S3 替身健康。
- 自动报告已经覆盖旧环境迁移、空库恢复、分层清理、新机导入、蓝绿与安全/XSS；无生产访问。
- 维护者确认后回复：`V2 阶段 11 验收通过，V2.0 最终验收通过`。

## 16. 人工验收记录

- 验收结论：通过；V2.0 最终验收通过。
- 维护者确认时间：2026-08-02 10:46 CST。
- 实现 Commit：`d240ba4b126c919649572663bc2a7e0418a5884b`。
- 验收准备修复 Commit：`e24d86ae35a816b879253e70f1d2800967da73fb`。
- 最终验收记录 Commit：`ae263ea732e167aac88a80dc27c9e197de3c4b0a`。
- 验收后 CI 快照初始修复 Commit：`b73a4a94de47b117ed6afd75776d048452e1c50b`。
- CI 远端 tag 独立性修复 Commit：本次独立本地 Commit，完整 SHA 由交付回复报告。
- 维护者确认原文：`V2 阶段 11 验收通过，V2.0 最终验收通过`。

## 17. 全阶段 Commit、交接与下一步

| 阶段 | 实现/修复 Commit | 验收记录 Commit |
| --- | --- | --- |
| 0 | `6a46251db9226aa5065dce35ab3a3b3c4a1ec85f` | `d20c0b9` |
| 1 | `42ca85976552fe483b80afd9050e99fd28422b2c` | `383db31` |
| 2 | `7cdc8c330042e10a1810b5b784ff38fc63ea007e`，后续隔离修复 `d50e715`、`4a2085b`、`d3cd75e`、`3caf82b` | `44213b8` |
| 3 | `90c2d58761847e72b4e354f1b85881e15a0c0a8c` | `a3f7b77` |
| 4 | `9a64eb38af952b999247cee864d759a3573b6932` | `ddcb6a3` |
| 5 | `86c034cb91231053affcf860765540d3ced50c8b`，修复 `a523cbb`、`8bf1067` | `b157552` |
| 6 | `d3528bf`，修复 `a535ce2`、`18baf8a`、`09369b3` | `1fe1116` |
| 7 | `45f4a5934d4dac9bfeb55ff406fed016d714b97b` | `dc3ed17` |
| 8 | `0f5b161`，修复 `ee738be`、`84f66b7` | `a087ba8` |
| 9 | `94dd1b6`，验收修复 `ef523b1`、`78cc261`、`b37b509` | `4eec170` |
| 10 | `88c059fcf4d686d543212117c46da9e1f83a0d88` | `845ea6a96b9764c58b047722559e05e53616a320` |
| 11 | `d240ba4b126c919649572663bc2a7e0418a5884b`，验收准备修复 `e24d86ae35a816b879253e70f1d2800967da73fb` | 最终验收 `ae263ea732e167aac88a80dc27c9e197de3c4b0a`；CI 初始修复 `b73a4a94de47b117ed6afd75776d048452e1c50b`；远端 tag 独立性修复完整 SHA 见交付回复 |

最终交接已追加到 `docs/CODEX_HANDOVER_V2.md`。V2.0 已正式通过最终验收；不进入新阶段，
本次验收记录提交后停止开发。任何生产 Push 或部署仍需另行明确授权。
