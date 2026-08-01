# Docker、自动部署、备份与恢复教程

本文是 V2 阶段 10 后的现行部署手册。阶段 9 及更早版本中“代码仓库 Markdown”“Nuxt
Content”“纯内容镜像通道”和 `cms_git_worktree` 的做法已经退役，只能从 Git 历史查阅，
不得在新环境执行。

## 1. 运行结构

```text
公网 HTTPS → 宿主机反向代理 → 127.0.0.1:3000 gateway
                                      ├─ app-blue
                                      └─ app-green
                                            └─ PostgreSQL / S3

CMS 发布 → PostgreSQL Revision + Outbox → content-export/reconcile
                                           └─ 独立内容仓库
```

`gateway`、蓝绿双槽和每分钟主动检查机制不变。PostgreSQL 只连内部网络。runtime 镜像
不包含正式 Markdown、Git 或 SSH；内容导出和恢复只由 operations profile 执行。

## 2. 数据与备份

| 数据 | 权威 | 保护方式 |
| --- | --- | --- |
| Vue、TypeScript、配置、migration | 代码 Git 仓库 | 分支保护与 Git 历史 |
| 新闻/Wiki/成员正式状态 | PostgreSQL 当前 Revision | custom-format dump + 隔离恢复演练 |
| 可读 Markdown 快照 | 独立内容仓库 | Git 历史、snapshot/manifest、bundle/远端备份 |
| 图片二进制 | S3/COS | Bucket 版本控制或复制 |
| gateway 当前槽位 | `.deploy/current` 与 volume | 可由部署脚本重建 |
| 密钥和真实 `.env` | 外部密码库 | 独立加密备份 |

Docker 镜像和独立内容仓库都不能代替 PostgreSQL 备份。不要删除 `postgres_data`，不要把
内容仓库挂到 app 容器，也不要将内容 snapshot 路径配置给 build。

## 3. 首次部署

1. 在服务器安装 Docker Engine、Compose plugin、Git 和 curl。
2. 用专用部署用户克隆代码仓库，保持工作树干净；配置只读 Git/GHCR 凭据。
3. 从 `.env.example` 创建真实 `.env`，保存到受限目录；不得提交密钥。
4. 在 GitHub Actions 已为目标完整 SHA 发布 runtime/operations 镜像后，执行：

```bash
./scripts/deploy.sh <40位目标SHA> application
```

部署器验证目标是 `origin/main` 的祖先，拉取两个同 SHA 镜像，执行向前 migration，在非活动
槽启动候选，检查 `/api/health`，再 graceful reload gateway。候选失败时保留当前槽位。

首次创建管理员只能在 migration 成功后通过 operations CLI 执行。应用容器不持有 Git、
SSH 或恢复权限。

## 4. 自动部署

GitHub Actions 对 PR 和 `main` 运行验证；`main` 只发布 `application` runtime 与 operations
镜像。服务器 timer 的检查入口为：

```bash
./scripts/auto-deploy.sh
```

检查器对当前上线 SHA 到 `origin/main` 的累计变化做祖先校验，唯一合法分类为
`application`。它等待两个目标镜像可用，再调用同一部署器。不存在 `content` 分类，也不因
某个路径跳过 migration。

CMS 发布内容的流程与代码部署完全分离：发布写 PostgreSQL/Outbox；异步 Worker 和凌晨
对账更新独立内容仓库。这个 Git 变化不会进入代码仓库，不触发 Actions 或镜像构建。

## 5. 发布代码

在开发 clone 完成测试并经人工审核后，使用普通 commit/push。任何 Vue、TypeScript、依赖、
Docker、workflow 或 migration 变化都走 application 蓝绿通道。数据库变化遵守
expand/contract；禁止 destructive down migration、reset、force push 和手改
`.deploy/current`。

只在服务器做只读状态检查：

```bash
./scripts/classify-deployment.sh <当前SHA> <目标SHA>
docker compose ps
curl --fail http://127.0.0.1:3000/api/health
```

分类输出应为 `application`。健康失败时保留目标 SHA、候选槽位、Compose 状态和脱敏日志，
不要勉强切流量。

## 6. 发布内容

内容只能通过 CMS 的草稿、审核和发布事务进入 PostgreSQL。发布成功后：

1. 前台立即从数据库 Current Revision 读取；
2. 创建异步 export job；
3. Worker 确定性导出 `news/`、`wiki/` 或 `members/` 到独立内容仓库；
4. 失败 job 留在数据库供重试；凌晨全量对账会从数据库修正仓库快照。

本地 Markdown 贡献通过独立内容仓库 PR 和 CMS“外部内容导入”完成。Dry Run/导入不会
Merge、批准或发布；评论和关闭 PR 都需要单独明确授权。

## 7. 备份与隔离恢复

创建和校验 PostgreSQL 备份：

```bash
BACKUP_ROOT=/绝对/外部/备份根 ./scripts/backup.sh
./scripts/backup-verify.sh /绝对/备份目录
```

正常迁移使用 `scripts/restore.sh` 恢复到完全空数据库，再运行 migration、pointer/hash 检查
和本机回环 HTTP 检查。独立内容仓库需另外保存 refs/bundle、`.vinci/snapshot.json`、
`manifest.json` 和三类 Markdown。

仅当完整数据库备份不可用时，才按 `docs/v2/BACKUP_AND_RECOVERY.md` 使用
`content-recovery` operations profile，从经校验 snapshot 初始化空库。它不能恢复用户、
会话、完整审核、审计或全部 Revision 历史。

演练必须使用唯一 Compose project、名称含 `test` 的数据库、本地测试 Git、回环端口和带
marker 的临时根；清理时逐项核对 label、名称和 marker，禁止 system-wide prune。

## 8. 回滚与故障取证

- 应用回滚用新的普通 `git revert <有问题的提交>` 并重新走 application 蓝绿部署。
- schema 只向前修复；不得对生产执行破坏性 down。
- 内容回滚使用 Revision restore，生成新的正式 Revision 和 export job。
- 独立内容仓库错误由数据库对账创建普通纠正 Commit；不得 reset 或 force push。
- 数据库灾难恢复优先使用最近已验证的完整 dump；内容 snapshot 只是最后手段。

保留目标/当前 SHA、活动/候选槽位、健康响应、migration 输出、备份 manifest 与 SHA、对账
report SHA、数据库 run ID 和脱敏容器日志。不要保存 Token、Cookie、私钥、数据库 URL 或
带凭据远端。

## 9. 阶段 10 检查

```bash
npm run test:v2:phase10
npm run typecheck
npm run build
docker compose config --quiet
```

runtime 镜像检查必须确认 `/app/content` 不存在，且 `/app` 不含受管正式 `.md`。Wiki 完整性
检查需显式设置 `WIKI_CHECK_SOURCE` 为独立内容仓库 snapshot 根；production build 不设置、
也不读取这个变量。
