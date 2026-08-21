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
负责人分别是社团会长、机器人队队长和基地实验室负责人；每个负责人作为所属机构的职责卫星展示，
不再脱离机构集中排成一层。“通常由同一人兼任”仍是可维护的共同说明。技术组别、社团其他部门继续
通过 `division`、`group` 和 `role` 表达，新闻部与运营组的孵化关系使用 `relations` 表达。

公开页面使用代码原生的嵌套动态“星系”布局，不依赖一张固定图片。中心使用不指向任何上级单位的
三节点协作图形；核心尺寸低于机构行星，三机构使用官方 Logo 沿大轨道缓慢公转，Logo 与文字始终
正向。每个机构同时拥有独立局部轨道：直属
`responsibility` 和所属 `division` 下的 `group` 都只围绕自己的机构运行，避免把 Vinci 部门、机电
部门和负责人错误混入同一外环。同一局部轨道的所有节点使用一致动画相位，保持固定角间距；部门
周围的 `role` 小卫星使用外扩轨道，与部门行星之间保留清晰空隙。点击部门行星会打开局部轨道聚焦
舱，岗位名称与岗位球沿部门轨道实际运行；没有岗位时明确显示“当前未配置下级岗位”。新闻部与
运营组关系使用一条按双方当前坐标实时更新、绕开中心的浅色动态曲线表达；曲线以浅薄荷绿为主色，
由低亮光晕、点状脉冲和浅暖黄移动光点构成。路径依次经过三个不同相位摆动的波峰，因此即使端点
暂停，形状本身也会持续明显而平滑地变化。关系层位于机构星系下方，任何机构、负责人或部门行星
都会自然遮住经过其下方的线条。
默认不显示关系正文，点击链路后才
打开独立关系说明框。公开图不显示机构的 division 说明或 `responsibilityNote` 共同说明，避免把
内部维护文案混入星图；这些字段仍保留在旧数据与 CMS 中以兼容既有配置。两个弹层都可用关闭按钮
或 `Esc` 退出。

三个官方 Logo 由 `OrganizationChart.vue` 中受控的稳定机构 ID 注册表维护，不允许 CMS 任意输入
外部图片地址：

- `institution-emis` → EMIS 透明 Logo；
- `institution-vinci` → Vinci 圆形 Logo；
- `institution-iri` → IRI Lab 透明宽幅 Logo。

这个映射只决定展示素材，不进入组织架构 JSON，也不改变数据库结构。Logo 托盘保持透明，不额外
叠加白色矩形背景。深色与浅色页面使用各自的星空背景、文字、轨道、行星和玻璃面板色板，机构、
部门和负责人名称使用比辅助文案更大的高对比字号。窄屏和 CMS 紧凑预览会
停止公转并按机构切换为可滚动语义卡片；窄屏点击部门时使用居中浮层显示局部星系。
`prefers-reduced-motion: reduce` 会停止机构、部门、岗位卫星、星光和闪电轨迹动画，但不影响点击
查看岗位或关系说明。
超过三个机构或两个部门分支时会追加“其他机构/其他分支”区域，不会静默隐藏数据。

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

公开页点击任一部门行星即可查看该部门的岗位局部轨道；点击连接新闻部与运营组的浅色链路可查看
关系起点、终点和说明；链路未点击时不显示关系正文。
三个负责人职责卫星也都是可点击按钮，点击后使用独立聚焦舱显示所属机构与职责节点；这不会引入
成员姓名或与 `members` 的数据联动。
再次选择其他部门会切换聚焦内容，关闭按钮或 `Esc` 返回完整星系。此交互只读取现有
`institution → responsibility / division → group → role` 树和 `relations`，不引入额外展示配置或
成员关联。

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
