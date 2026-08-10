# 成员选项、公开申请与 Wiki PDF

## 1. 用户能够做什么

- Wiki 阅读页在“编辑本文”旁显示“下载 PDF”。已登录用户可下载由 Pandoc 生成的 PDF；未登录用户会先进入登录页，登录后返回原 Wiki。
- Markdown 中 `/...` 形式的图片地址在展示和 PDF 导出时补齐 `https://cdn.sdutvincirobot.top`，权威数据库和独立内容仓库原文不被改写。
- 管理员在 `/cms/member-options` 按年级维护赛季和组别，也可添加新一届；年级是稳定基准。
- 管理员编辑成员时从年级、赛季、组别和职责选项中选择。职责允许多选：队长、副队长、组长、机电创新学会会长、指导老师、成员、顾问。
- 任意访客可在 `/team/apply` 填写成员资料并上传头像。管理员在 `/cms/member-applications` 审核；明确通过后才上线。

## 2. 页面和 API 应返回什么

- `GET /api/member-options` 只返回启用的年度配置和固定职责；CMS 管理接口只允许管理员。
- 2016–2021 级默认组别为机械组、电控组、运营组；2022–2024 为机械组、控制组、电路组、视觉算法组、运营组；2025 为机械组、嵌入式组、软件算法组、运营组。
- 成员类型由服务端推导：队长/副队长/会长为团队负责人，指导老师为指导老师，顾问保留为顾问，其余按组别作为普通组员展示；用户不能直接写成员类型。
- 头像经 Sharp 解码、缩放并转换为 WebP，对象名为 `member-applications/<年>/<姓名>-<SHA-256前8位>.webp`。
- 公开提交返回 `submitted`，CMS 审核通过后创建正式成员、不可变 Revision 和导出 Outbox。

## 3. 权限、安全和异常情况

- PDF API 要求有效 CMS 会话，响应为 `application/pdf`、`private, no-store`；路径只能是 `/wiki/...`。Pandoc 或 PDF 引擎不可用时返回 503。
- 公开申请使用 256 位随机访问令牌，数据库只保存 SHA-256；按来源 IP 限流。上传内容按真实图片解码，不信任扩展名。
- 未提交申请有效期 24 小时。离开页面会请求撤销；任意后续申请操作还会清理已过期临时头像。提交后不自动删除，审核拒绝时删除，审核通过时作为正式头像保留。
- 服务端再次校验年级、组别、固定职责和公开 URL。未知职责、过期令牌、重复/越权审核均拒绝。
- 本地人工环境使用 `vinci_cms_local_test`、回环 MinIO 测试 Bucket 和回环端口，不连接生产 S3/COS。

## 4. 明确不需要实现的内容

- 不修改独立 `sdutvinci_content` 中的正式 Markdown，不恢复代码仓库 `content/`，不引入 Nuxt Content。
- 不允许访客自行上线资料、选择系统成员类型、创建登录账号或绑定账号。
- 不实现批量导出整套 Wiki、复杂 PDF 模板编辑器或生产对象迁移。
- 不 Push、不部署、不 SSH、不连接或修改生产数据库/S3/COS。

## 5. 本地验收

```bash
./scripts/cms-local-test.sh start
```

访问 `http://127.0.0.1:3300/team/apply` 提交申请；再用 `testadmin` / `VinciLocalTest!2026` 登录，检查成员选项和成员申请。打开任意 Wiki，验证未登录跳转、登录返回与 PDF 下载。测试环境内的 MinIO 只监听 `127.0.0.1:5901`。

自动验证使用另一个名称含 `test` 的临时数据库，不能使用浏览器人工验收库：

```bash
V2_CONTENT_SNAPSHOT_SOURCE=/home/tungchiahui/UserFolder/MySource/sdutvinci_content npm run test:cms
npm run typecheck
npm run build
git diff --check
```

回滚应用使用普通 `git revert <commit>`。Migration `0018` 为 expand-only，应保留申请、审核和成员 Revision 证据，不执行自动 down。
