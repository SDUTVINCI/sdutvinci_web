# 当前组织架构

## 1. 功能边界

组织架构用于展示团队当前采用的部门和层级关系，公开地址为 `/team/organization`，管理员维护地址为 `/cms/organization`。

它与成员名录完全独立：节点只保存名称、类型、说明、父节点和顺序，不保存成员 ID、姓名、头像、组别字段或赛季。把公开入口放在 Team 下只是信息架构上的归类，不代表它与 `members` 表联动。

公开页面只展示最新发布版本，不提供赛季选择和历史架构。数据库审计日志会记录保存和发布操作，但不提供旧架构的公开浏览界面。

## 2. 数据模型

`organization_configs` 只有稳定键为 `current` 的一行：

- `draft_structure`：CMS 当前草稿；
- `published_structure`：公开页面读取的正式数据；
- `version`：草稿乐观锁版本；
- `published_version`、`published_at`：当前公开版本及发布时间；
- `updated_by_user_id`：最后维护管理员，仅用于审计，不是架构成员关联。

架构 JSON 包含：

- `nodes`：树节点，使用稳定 ID、`parentId` 和 `sortOrder` 组织层级；
- `relations`：无法由父子树表达的跨部门关系；
- `responsibilityNote`：三个负责人职责的共同说明；
- 页面标题、说明和根节点 ID。

节点层级固定为：

```text
organization
└── institution
    ├── responsibility
    └── division
        └── group
            └── role
```

当前正式初值把“机电创新学会 EMIS”“Vinci 机器人队”和“IRI Lab 智能机器人创新实践基地”
保存为三个独立 `institution`，不会合并成一个机构节点。IRI 的定位说明为“实验室”。三个机构的
负责人分别是社团会长、机器人队队长和基地实验室负责人；公开图在负责人层把机器人队队长放在
中间并突出显示，“通常由同一人兼任”作为可维护的共同说明。技术组别、社团其他部门继续通过
`division`、`group` 和 `role` 表达，新闻部与运营组的孵化关系使用 `relations` 表达。

公开页面使用代码原生的动态“星系”布局，不依赖一张固定图片。中心“协同运行”保持固定，三机构
使用官方 Logo 沿同一轨道缓慢公转，Logo 与文字始终正向；机构获得鼠标悬停或键盘焦点时整组公转
暂停，方便阅读。负责人层保持固定，机器人队队长继续位于正中并突出显示；两侧部门使用外围卫星
轨道，新闻部与运营组关系使用底部彗星轨迹表达。

三个官方 Logo 由 `OrganizationChart.vue` 中受控的稳定机构 ID 注册表维护，不允许 CMS 任意输入
外部图片地址：

- `institution-emis` → EMIS 透明 Logo；
- `institution-vinci` → Vinci 圆形 Logo；
- `institution-iri` → IRI Lab 透明宽幅 Logo。

这个映射只决定展示素材，不进入组织架构 JSON，也不改变数据库结构。窄屏、CMS 紧凑预览和
`prefers-reduced-motion: reduce` 会停止公转并切换为可滚动语义卡片；超过三个机构或两个部门分支时
会追加“其他机构/其他分支”区域，不会静默隐藏数据。

服务端会拒绝重复 ID、多个根节点、悬空父节点、环、断开的节点、悬空关系以及超过长度或数量上限的数据。迁移 `0025_fat_marauders.sql` 会创建表并写入当前组织架构初值。

## 3. 管理员使用方法

1. 以管理员身份打开 `/cms/organization`。
2. 在左侧架构树选中节点；可以添加子节点、上下移动或删除节点。负责人使用“负责人职责”类型，
   每个机构最多一个。
3. 在节点属性区修改名称、类型和说明；选中根节点时还可以维护“通常由同一人兼任”等职责共同说明；
   中间区域会实时显示公开效果。
4. 跨部门关系单独选择起点、终点并填写说明。
5. 点击“保存草稿”。此时公开页面不会改变。
6. 确认预览后点击“发布架构”，公开页面才切换到该版本。

“发布架构”在本地修改尚未保存时不可用。两个管理员同时编辑时，后提交的旧版本请求会收到 `409`，必须刷新后重新修改，避免静默覆盖。

## 4. API

- `GET /api/organization`：匿名读取已发布架构；
- `GET /api/cms/organization`：管理员读取草稿与正式版本；
- `PATCH /api/cms/organization`：管理员保存草稿，需要 CSRF 和 `expectedVersion`；
- `POST /api/cms/organization/publish`：管理员发布草稿，需要 CSRF、`expectedVersion` 和固定确认值 `PUBLISH_ORGANIZATION`。

CMS 写接口只允许 `admin` 角色。公开 API 永远不返回草稿。

## 5. 本地验证

保留现有人工测试环境时，可以先执行前向迁移，再访问：

```bash
DATABASE_URL=postgresql://vinci_local_test:vinci-local-test-password@127.0.0.1:55439/vinci_cms_local_test \
CMS_AUTH_SECRET=cms-local-test-secret-with-at-least-32-characters \
npm run db:migrate
```

随后检查 `http://127.0.0.1:3300/team/organization` 和 `http://127.0.0.1:3300/cms/organization`。服务必须只监听回环地址。

自动化测试包括：

```bash
npm test -- tests/organization.test.ts
TEST_DATABASE_URL=postgresql://.../organization_feature_test \
npm test -- tests/organization.integration.test.ts
```

集成测试数据库名必须明确包含 `test`，不得指向 `vinci_cms_local_test`；测试结束后删除临时数据库。
