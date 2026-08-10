# CMS 一键本地测试环境

## 1. 用途与安全边界

该脚本为浏览器人工测试创建一次性 CMS：独立 PostgreSQL 17、回环 MinIO 测试图床、完整 Migration、独立内容仓库中的
2 篇新闻、226 篇 Wiki、32 名成员及一个测试管理员。数据库、图床和网页只监听 `127.0.0.1`，不读取或
修改项目 `.env`，不连接生产服务，也不写 `sdutvinci_content`。

默认要求两个仓库互为同级目录：

```text
父目录/
├── SDUTVINCI_NUXT/
└── sdutvinci_content/
```

需要 Docker、Node.js/npm，且已在 Web 仓库执行 `npm ci`。内容仓库必须是干净工作区。

## 2. 一键启动

在 Web 仓库根目录执行：

```bash
./scripts/cms-local-test.sh start
```

启动完成后使用：

```text
地址：http://127.0.0.1:3300/cms/login
账号：testadmin
密码：VinciLocalTest!2026
```

重复执行 `start` 不会重建或覆盖正在运行的环境，只会报告现有地址。

若内容仓库不在默认同级位置，可只为本次命令指定绝对路径：

```bash
CMS_LOCAL_TEST_CONTENT_ROOT=/绝对路径/sdutvinci_content \
  ./scripts/cms-local-test.sh start
```

## 3. 状态、重建和日志

```bash
./scripts/cms-local-test.sh status
./scripts/cms-local-test.sh restart
```

`status` 应显示 `articles=228,members=32`。`restart` 会先删除旧隔离数据库，再从当前内容仓库重新
创建，旧测试草稿和修改不可恢复。查看 Nuxt 日志：

```bash
docker logs vinci-cms-local-test-app
```

默认端口冲突时，可在首次启动或重建时覆盖回环端口：

```bash
CMS_LOCAL_TEST_DATABASE_PORT=55449 CMS_LOCAL_TEST_APP_PORT=3310 \
  ./scripts/cms-local-test.sh start
```

同一环境后续的 `status`/`stop` 应继续传入相同端口变量。测试图床端口可用
`CMS_LOCAL_TEST_S3_PORT` 覆盖，默认 `5901`。脚本会构建名称含 `test` 的 runtime 镜像，确保
人工环境内具备 Pandoc、XeLaTeX 和中文字体。

## 4. 停止并清理

测试完成后执行：

```bash
./scripts/cms-local-test.sh stop
```

该命令只会删除名称为 `vinci-cms-local-test-app`、`vinci-cms-local-test-postgres`、
`vinci-cms-local-test-s3`，且标签均为
`com.sdutvinci.scope=cms-local-test` 的隔离容器。
数据库随容器删除且不可恢复。名称或归属不匹配时脚本 fail closed，不会删除其他容器。

## 5. 明确不包含的内容

- MinIO 仅模拟本功能明确需要的头像上传；不模拟生产 S3/COS、GitHub PR、内容导出 Worker、定时服务或部署。
- 不把测试账号或密码写入生产配置、数据库 Migration 或项目 `.env`。
- 不 Push、不部署、不修改生产数据库和独立内容仓库。
- 正式自动化验证仍应运行 `npm run test:cms`、`npm run typecheck` 和 `npm run build`。
