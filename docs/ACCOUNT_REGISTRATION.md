# CMS 成员账号注册与审核

## 1. 使用流程

1. 未登录成员打开 `/cms/login`，切换到“申请注册”。
2. 在可搜索成员选择器中按姓名或稳定 ID 选择自己的正式成员信息。
3. 页面自动显示只读账号 ID。账号以成员稳定 ID 为基准；若已被其他账号或待审核申请占用，依次使用
   `id1`、`id2` 等最小可用数字后缀。
4. 输入并确认至少 12 个字符的密码，提交审核。申请通过前不能登录。
5. 管理员进入 CMS“账号管理”的“注册申请审核”，核对成员后通过或拒绝。通过后账号固定获得
   `member` 普通成员身份；管理员身份只能由已有管理员另行调整。

若选择器中没有本人资料，先从注册表单中的入口前往 `/team/apply` 填写成员信息。成员资料本身也需
审核上线，之后才能申请账号。若成员已绑定账号，页面会提示联系 Vinci 机器人队管理员找回密码，
不会允许重复注册。

## 2. 数据与安全边界

- Migration `0023_dusty_hellion.sql` 新增 `account_registration_applications`，不修改已有用户、成员、
  Revision 或内容表。
- 浏览器不提交账号 ID；服务端在事务与 advisory lock 下重新分配并保留 ID，避免并发重名。
- 待审核申请只保存 Argon2id 密码哈希，从不保存或返回明文密码。审核通过或拒绝后都会清除申请表中的
  密码哈希。
- `user_members` 的唯一约束继续保证一名正式成员只能绑定一个账号。审核通过会在同一事务中创建用户、
  写入唯一 `member` 角色、绑定成员、更新申请和写审计；任一步失败则全部回滚。
- 公开提交要求同源，并按来源 IP 做持久化限流。CMS 列表和审核写接口仅管理员可用，审核写入继续校验
  同源、会话和 CSRF。
- 审计只记录申请、成员、账号和动作，不记录密码或密码哈希。

## 3. 本地验证

使用 `scripts/cms-local-test.sh` 启动仅监听回环地址的人工环境。应用新 Migration 后，可用正式成员
选择器提交注册申请，再使用 `testadmin` 登录 `/cms/users` 审核。审核通过后退出管理员账号，使用新
账号密码登录，确认身份显示为普通成员。

破坏性自动测试必须使用名称明确含 `test` 的临时数据库；不得把 `vinci_cms_local_test` 作为
`TEST_DATABASE_URL`。相关自动测试为：

```bash
TEST_DATABASE_URL=postgresql://.../vinci_account_registration_test \
  ./node_modules/.bin/vitest run \
  tests/account-registrations.integration.test.ts \
  tests/account-registration-ui.test.ts
```

本功能不访问或修改独立内容仓库，不改文章/成员 Markdown，不写 S3/COS，不调用内容导出或发布流程。
