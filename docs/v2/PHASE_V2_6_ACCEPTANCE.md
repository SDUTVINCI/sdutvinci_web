# V2 阶段 6 验收：独立内容仓库与异步增量导出

> 状态：实现和自动验证已完成，等待维护者浏览器人工验收。本文只覆盖阶段 6；没有
> 使用生产数据库或生产 Git 凭据，没有写真实内容仓库，没有 Push 代码、部署或进入
> 阶段 7。下文所有人工验收项保持未勾选，直到维护者明确确认。

## 1. 结论与边界

新闻和 Wiki 的正式权威仍是 PostgreSQL 当前 Revision。阶段 6 在数据库事务提交后，
通过 Outbox Worker 把当前数据库状态单向、异步、确定性地导出到唯一正式内容仓库
`SDUTVINCI/sdutvinci_content` 的 `main`。GitHub 或导出失败不会回滚、隐藏或降级已经
发布的数据库 Revision。

```text
DB-first publish transaction
  └─ pending content_export_job
       └─ advisory-lock Worker
            ├─ claim batch + lease
            ├─ load current DB state
            ├─ verify snapshot/manifest and unaffected files
            ├─ write/move/delete only managed news/ and wiki/ paths
            ├─ update .vinci/snapshot.json + manifest.json
            ├─ one ordinary Commit for the batch
            ├─ verify remote main is still expected base
            └─ non-force Push + remote SHA verification
                 ├─ success: mark jobs succeeded with Commit SHA
                 └─ failure: reset dedicated workspace, retry/backoff
```

本阶段没有 PR 反向导入、凌晨全量对账或自动修复，没有成员权威切换，没有删除代码仓库
`content/`，也没有移除 Nuxt Content。内容仓库不是网站运行时或镜像构建输入。

## 2. 数据库、序列化与幂等

Migration `0014_tranquil_magdalene.sql` 是 expand-only：

- 新增 `content_export_runs`，记录 Worker/接管运行、基线/本地/结果 Commit、计数、
  脱敏错误和报告；
- 给 `content_export_jobs` 增加目标/旧路径、预期 SHA-256、租约、最近运行及实际导出
  路径/哈希；
- 新列均可空，保留阶段 5 和旧 Git-first 字段及写法；
- 只新增表、列、索引、检查和外键，不删除表/列，不执行 down migration。

序列化格式固定为 version 1：

- 输出路径仅允许 `news/<relativePath>` 或 `wiki/<relativePath>`；
- frontmatter 先写 `vinciId`，再写系统字段、集合字段，未知字段按 Unicode 码点排序；
- 嵌套对象键递归排序，数组顺序和字符串类型保持；
- 统一 LF，文件末尾恰好一个换行；
- 同一 Revision 输入产生完全相同的字节和 SHA-256；
- `.vinci/snapshot.json` 保存 article/revision/path/hash/bytes 和 tombstone；
- 根 `manifest.json` 保存 snapshot 哈希和所有活动文件哈希；
- 根 `README.md` 明确 `main` 是数据库只读快照，proposal 不能作为发布。

发布、恢复、移动、删除写 Outbox 时同时记录序列化目标和预期哈希。Worker 按文章合并
同一批任务，并以领取时数据库当前状态为最终结果；重复任务、重复运行和无字节变化不会
产生空 Commit。成功状态只在远端 `main` 已验证指向预期 SHA 后提交。

## 3. Worker、失败补偿与安全边界

- PostgreSQL session advisory lock 保证接管和 Worker 互斥；领取使用
  `FOR UPDATE SKIP LOCKED`。
- `processing` 任务有 owner/expiry 租约；过期租约安全回收。
- 重试使用指数退避、最大次数和 `next_attempt_at`；达到上限进入 `failed`。
- 管理员可在文章详情查看尝试次数、下次重试、脱敏错误并执行带同源、CSRF、权限和审计
  的手动重试。
- Push 前再次读取远端 `main`；远端变化、非快进、脏工作区或元数据漂移均 fail closed。
- Push 只使用普通 `git push HEAD:refs/heads/main`，从不 Force Push。
- 失败后只对带精确归属标记的独立工作区 fetch/reset，并只 clean 受控导出路径；
  数据库 Revision/current pointer 不回滚。
- 正式配置只接受唯一仓库和 `main`。非正式远端仅在
  `NODE_ENV=test + CONTENT_EXPORT_TEST_MODE=true` 使用。
- 正式 enabled 模式要求独立 SSH key、固定 known_hosts 和 SSH 远端；URL 禁止内嵌
  凭据。工作区不得与应用代码、代码仓库 `content/` 或旧 CMS worktree 重叠。
- 文件操作拒绝绝对路径、`..`、NUL、符号链接和非普通文件；首次接管只删除可识别的旧
  `content/news|wiki` 文件，无法识别的文件全部保留。
- Git stderr、API/CMS 错误和运行报告通过统一敏感信息遮盖器，不回显 token、密码、
  SSH key 路径或带凭据 URL。

## 4. 首次接管协议

正式接管分成两个不可合并步骤：

1. `CONTENT_EXPORT_MODE=dry_run` 通过只读 clone 生成完整报告，不创建持久工作区、不写
   DB、不改分支/文件、不 Commit/Push；
2. 维护者核对报告的仓库 ID、`main`、base Commit、clean、文件数量、每一项动作、
   preserved files 和 conflicts 后，提供精确
   `TAKEOVER:<baseCommit>:<reportSha256>`；只有 enabled 模式和完全匹配的令牌才能逐项
   接管。

接管不清空仓库。它逐项移动、更新、写入或删除已识别的新闻/Wiki，写 metadata/README，
保留成员及其他未知文件，并产生普通父子 Commit。接管期间若远端变化、存在双路径冲突、
工作区不安全或 Push 失败，会停止并补偿工作区。

2026-07-30 对真实公开内容仓库执行了两次只读盘点。数据库来源是从本地现有
`content/` 回填的明确隔离数据库，不是生产数据库，因此此结果只证明仓库基线和算法，
不能作为真实接管授权：

```json
{
  "repositoryId": "SDUTVINCI/sdutvinci_content",
  "branch": "main",
  "baseCommit": "7636bca74a1591f78f7268927cbfa8ab677b24bb",
  "clean": true,
  "repeatable": true,
  "trackedFileCount": 260,
  "databaseFileCount": 228,
  "databaseDeletedCount": 0,
  "actionCounts": {
    "move_and_update": 228
  },
  "preservedFileCount": 32,
  "preservedScope": "content/members/**",
  "conflicts": [],
  "reportSha256": "376c61414b6e7f8f8da703a48d28d7201eff94106a68bfaa3b6bbd5702fd68f4"
}
```

两次报告字节一致；远端 HEAD、tree、文件和分支未改变，没有持久 clone 或 DB run 记录。
所有 228 个旧文件与隔离数据库原 Revision 字节相同，变化来自目录移动、稳定
`vinciId` 和确定性 frontmatter。32 个成员文件全部列为 preserved。真实接管前仍必须
用当时生产数据库重新生成报告，由维护者重新确认新的 SHA 和令牌。

## 5. 部署、权限与回滚

阶段 6 本轮没有部署。正式部署时先按 `docs/DEPLOYMENT.md` 应用 expand-only
Migration，保持 Worker disabled。只读 dry-run 使用公开 HTTPS，不注入写凭据。

维护者批准真实报告后，创建只授权
`SDUTVINCI/sdutvinci_content` 的独立 repository-scoped SSH deploy key（允许写）；
不得复用代码部署 key、个人全局 key 或生产应用 key。known_hosts 必须预先固定 GitHub
主机键。使用 `compose.content-export.yaml` 只读挂载两个文件，独立 named volume 保存
内容工作区，Worker 只接 backend 网络。

```bash
docker compose -f compose.yaml -f compose.content-export.yaml \
  --profile content-export config --quiet
docker compose -f compose.yaml -f compose.content-export.yaml \
  --profile content-export up -d content-export-worker
```

故障时：

1. 先把 `CONTENT_EXPORT_MODE=disabled` 并停止 Worker，数据库发布和前台继续 DB-first；
2. 保存 job/run ID、脱敏日志、远端 HEAD、工作区状态和一致性 JSON；
3. 不手改 job 为 succeeded，不删除 Outbox，不 down migration，不 Force Push；
4. 修复仓库权限/网络后，在 CMS 对达到上限的 job 点手动重试；
5. 若内容仓库出现维护者写入或非快进，保持停止并人工审计；阶段 6 不自动覆盖；
6. 只有在明确审计后才可对内容仓库使用普通 `git revert`，不得 reset/force；随后必须
   重新建立与数据库的一致导出计划。

停用导出不要求切回 Git-first。若另行执行阶段 5 的完整发布权威回滚，仍必须同时切换
五个阶段 5 开关，并处理回滚窗口产生的 Git-only 内容；这与导出 Worker 回滚是两件事。

## 6. 自动验证记录

自动测试仅使用：

- `vinci-v2-phase6-test-db` / `vinci_v2_phase6_test` /
  `127.0.0.1:55447`；
- 同容器内临时 `vinci_v2_phase6_dry_run_test`；
- 每项测试独立的 `mkdtemp` 根、本地裸 Git 远端和导出 workspace；
- 人工脚本冒烟的 `vinci-v2-phase6-manual-test-db`、`55448`、`34161` 和
  `/tmp/vinci-v2-phase6-manual-test`。

覆盖只读 dry-run 可重复且零变更、精确确认接管、advisory lock 互斥、增量新增/修改/
移动/删除、批量单 Commit、无空 Commit、Push 拒绝、指数退避、最大重试、远端恢复、
手动重试审计、数据库发布不回滚、凭据遮盖、snapshot/manifest/README、未知文件保留、
无代码工作流、序列化字节和路径/配置 fail closed，以及 CMS/仓库一致性。

最终验证结果：

- 阶段 6 专项：1 文件，9/9；
- 完整 CMS 回归：13 文件，90/90；
- 普通测试：4 文件、17 项通过；10 个数据库文件、80 项在无测试 URL 时安全跳过，
  数据库路径已由完整 CMS 回归覆盖；
- Phase 0 基线：260 个 Markdown 通过；Wiki：226 个文件通过；
- `npm run typecheck`、`npm run build`、基础/内容导出 Compose config、全部 shell
  脚本语法和 `git diff --check` 通过；
- 构建处理 4 个集合/260 个内容文件；仅有既有静态图片解析和 Nuxt timing warning，
  退出码为 0。

自动/冒烟资源已按名称、标签和归属标记精确清理。最终只剩任务开始前已有的
`vinci-cms-postgres`；`55447`、`55448`、`34161`、阶段 6 临时根和 dry-run clone 均无
残留。

## 7. 浏览器优先人工验收

### 7.1 启动与接管测试仓库

前置条件：Docker 可用，`55448` 和 `34161` 未占用。脚本只读取代码仓库 `content/`，
在 `/tmp` 复制测试初始仓库，不修改原 Markdown，不使用 GitHub 或生产凭据。

```bash
./scripts/v2-phase6-manual-acceptance.sh start
./scripts/v2-phase6-manual-acceptance.sh admin
```

第二条只创建隔离管理员。随后 Codex 代为运行
`takeover-dry-run`，向维护者报告每项摘要；维护者确认测试报告后，Codex 再运行
`takeover-apply`、`worker`、`inspect` 和 `consistency`。预期：

- 初始 260 文件，228 个 `move_and_update`，32 个成员 preserved，0 conflict；
- 接管只增加一个普通 Commit，结果为 2 news、226 wiki、32 preserved members；
- snapshot/manifest 为 228 项且哈希一致，`.github/workflows` 为 0；
- 一致性 `issueCount: 0`。

### 7.2 浏览器操作与预期

打开 <http://127.0.0.1:34161/cms/login> 并使用隔离管理员：

1. 选择一篇新闻或 Wiki，创建草稿，加入容易识别的“阶段 6 单篇导出”文本，提交审核并
   发布。预期发布立即成功、前台立即显示新正文；详情先显示等待/处理中，5 秒轮询后最迟
   1～3 分钟内变为“已同步”，出现 40 位内容 Commit。
2. 连续对两篇不同文章各发布一次。预期两个数据库 Revision 都立即生效；Worker 可把
   同一轮领取合并为一个合理 Commit，不要求“一文章一 Commit”，两个 job 最终记录相同
   或相邻的有效 Commit。
3. 在一篇文章详情检查导出状态。预期显示当前 Revision、尝试次数、结果 Commit，不显示
   凭据、绝对 key 路径或原始 Git stderr。
4. 通知 Codex 模拟测试远端不可写；Codex 只运行 `deny-remote`。再发布一次容易识别的
   “数据库不受 Git 影响”修改。预期发布和前台立即成功；导出经过两次尝试后显示失败及
   脱敏错误，数据库当前 Revision 保持新版本。
5. 通知 Codex 恢复测试远端；Codex 只运行 `repair-remote`。在同一文章详情点击“手动
   重试导出”。预期请求成功，状态回到等待/处理中，1～3 分钟内变为已同步；前台正文从未
   回滚。
6. 通知 Codex执行只读检查。Codex运行 `inspect` 和 `consistency`。预期最新 Commit
   包含相应文章、Markdown frontmatter 有稳定 `vinciId`、snapshot 指向当前 Revision、
   manifest snapshot 哈希匹配、`issueCount: 0`。

不要在浏览器打开或修改生产站，不要提供真实内容仓库凭据。任何一步不符合预期时立即
停止，保存完整 URL、截图、Console/Network、Revision/job/run/Commit ID 及
`application.log`、`worker.log`、一致性 JSON；先修复和重验，不勉强判定通过。

### 7.3 精确清理

维护者完成或中止后，由 Codex 运行：

```bash
./scripts/v2-phase6-manual-acceptance.sh stop
./scripts/v2-phase6-manual-acceptance.sh status
```

预期先核对容器标签、临时根标记、PID 命令和 Git 远端归属，再只删除阶段 6 人工数据库、
本地裸远端、独立 workspace、日志和临时目录。不得运行宽泛 Docker prune 或删除其他
阶段资源。

### 7.4 首轮人工验收发现与修复

维护者首轮发布已确认数据库版本立即生效、前台显示新正文。截图同时证明文章详情只显示
64 位“基线 SHA-256”，没有显示阶段 6 要求的 40 位内容仓库 Commit。只读核对确认
Worker 尚未启动，并发现 API 已返回 `latestExportedCommitHash`、页面却没有渲染该字段。

验收随即停止，没有把基线哈希误判为导出 Commit。页面已增加“内容仓库 Commit”显示，
仅在存在最近成功导出时渲染。修复后重新通过 `npm run typecheck`、完整 CMS 13 文件
90/90 和 `npm run build`；旧隔离环境已按归属标记精确清理。下轮必须在重新接管并启动
Worker 后，通过浏览器确认该字段为 40 位 Git SHA；本节不代表人工验收通过。

## 8. 人工验收清单

- [ ] 我检查真实内容仓库的只读盘点报告，确认仓库和首次复制内容未被修改。
- [ ] 我使用测试内容仓库完成首次全量导出。
- [ ] 我在线发布一篇文章，确认 1～3 分钟内增量导出。
- [ ] 我发布多篇文章，确认 Commit 数量合理。
- [ ] 我模拟内容仓库不可写，确认网站发布不受影响。
- [ ] 我修复权限并手动重试成功。
- [ ] 我检查 `vinciId`、snapshot 和 manifest。
- [ ] 我明确回复“V2 阶段 6 验收通过”。

## 9. 阶段结论与 Commit

- [x] 阶段 6 实现与自动验证完成。
- [x] 没有修改代码仓库现有 `content/` Markdown。
- [x] 没有写真实内容仓库、Push、部署或进入阶段 7。
- [x] 自动与冒烟临时资源已精确清理。
- [ ] 维护者浏览器人工验收完成。
- [ ] 维护者明确允许阶段 6 收尾。
- 阶段 6 实现 Commit：由最终回复报告，不在 Commit 内预填自身 SHA。
