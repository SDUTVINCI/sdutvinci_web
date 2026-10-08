# Vinci 官网搜索收录与维护

## 1. 代码负责的部分

公开页面统一通过 `useContentSeo` 输出独立标题、清理后的摘要、canonical、Open Graph、Twitter
分享卡片和安全序列化的 JSON-LD。首页标明官网身份；Wiki 章节标题包含所属文档，避免通用章节
名称在搜索结果中缺少上下文。结构化数据包含 Organization、WebSite、WebPage、面包屑；新闻使用
NewsArticle，Wiki 使用 TechArticle。只使用既有真实信息，缺失日期不补成当前日期。

这些页面由运行时 SSR 生成，`NUXT_PUBLIC_SITE_URL` 和百度验证值支持运行容器配置。正式 HTTPS
域名默认使用维护者提供的公开验证值 `codeva-FERDraaDA8`，其他域名不使用这个默认值；非空
`NUXT_PUBLIC_BAIDU_SITE_VERIFICATION` 优先覆盖。修改环境变量后重建运行容器即可；不能仅 reload
反向代理。

- `/robots.txt`：允许公开页面与 `/_nuxt/` 等渲染资源抓取，声明 XML Sitemap，禁止抓取 API。
- `/sitemap.xml`：公开核心栏目、组织架构、已发布的公开新闻/Wiki 与成员档案；文章和成员输出
  真实版本修改时间，栏目使用其公开内容的最新版本时间。没有可靠时间的静态页面省略 lastmod。
- `/sitemap.txt`：同一清单的纯文本绝对网址，方便平台手动提交；保持匿名规则，即使请求携带登录
  Cookie 也不包含受限文章。
- CMS、申请表、搜索页、占位项目页输出 noindex。CMS 和 API 同时通过 HTTP 响应头标记。
  已登录访问受限文章时也输出 noindex，并省略 JSON-LD；匿名访问沿用登录回跳。
- 错误响应通过 HTTP 头标记 noindex，真实不存在的页面仍返回 404。`/docs` 使用 301 跳转 `/wiki`。

robots 不屏蔽 CMS、搜索页或占位页，保证爬虫能够读到 noindex。访问控制继续由会话与公开查询
完成，robots 与 noindex 不承担权限控制。

## 2. 百度站点验证与首次提交

当前正式主域名为 `https://vinci.sdut.edu.cn`。在[百度搜索资源平台](https://ziyuan.baidu.com/)
添加这个准确的 HTTPS 站点，查看账号当前支持的验证方式和提交权限。

2026-10-08 已接入维护者提供的 HTML 验证标签。正式站点可直接使用默认值完成平台验证；这是
公开的站点归属验证值，不是 API Token。更换账号或验证值时，将平台给出的标签中 **content 的值**
写入生产 `.env`：

```dotenv
NUXT_PUBLIC_SITE_URL=https://vinci.sdut.edu.cn
NUXT_PUBLIC_BAIDU_SITE_VERIFICATION=平台给出的content值
```

不粘贴整个 HTML 标签，也不把 API 推送 Token 填在此处。按现行蓝绿更新流程重建运行容器后，
查看首页原始 HTML 是否包含正确的 `baidu-site-verification` 标签，再回平台完成验证。
如果使用 DNS 验证，则无需额外设置此变量。

验证通过后，在平台当前可用的“普通收录”入口执行：

1. 有 Sitemap 权限时，提交 `https://vinci.sdut.edu.cn/sitemap.xml`，类型选择 URL 列表。
2. 有手动提交权限时，从 `https://vinci.sdut.edu.cn/sitemap.txt` 取出网址，优先提交首页、招新、
   成果、联系和重要公开新闻；遵守账号配额，不反复批量重复提交。
3. 使用抓取诊断检查首页，检查索引量、抓取异常和流量关键词；记录提交日期与反馈。
4. 后续比较“Vinci机器人队”“山东理工大学 Vinci 机器人队”和“山理工 Vinci 招新”等真实搜索
   需求的展现、点击与落地页，结合平台数据调整。

平台权限和配额以登录账号显示为准。网址提交成功表示已通知百度，不等于已经收录；其他搜索
引擎的结果也不能作为百度收录证据。结构化数据有助于表达页面关系，不承诺百度富结果或排名。

## 3. 旧域名的永久迁移

审计时 `sdutvinci.cn` 与 `www.sdutvinci.cn` 返回 302，且保留路径与查询参数。这是应用前面的
1Panel/OpenResty 配置，仓库中的 Nuxt 路由无法覆盖已经由代理返回的跳转。

如果旧域名长期迁往学校域名，在这些旧域名现有的 HTTP 和 HTTPS `server` 配置中，把原跳转
改为以下指令；HTTPS 保留现有有效证书，不在主域名的 server 中添加这条规则：

```nginx
return 301 https://vinci.sdut.edu.cn$request_uri;
```

配置修改后执行 `nginx -t`（或 1Panel 提供的配置校验）再 reload。校验例如：

```bash
curl -sSI 'https://sdutvinci.cn/news/2024-07-06?from=old-site'
# HTTP 状态应为 301，Location 应完整保留 /news/2024-07-06?from=old-site
curl -sSI 'https://vinci.sdut.edu.cn/recruitment'
# 主域名应为 200，不形成循环
```

如果仍控制 `sdutvincirobot.top` 等历史域名，也在证书、DNS 与服务器访问正常后逐一处理；不要
为未知域名或失效证书宣称迁移已完成。平台有“网站改版”权限时，按其规则提交旧、新网址关系。
在团队 GitHub、Bilibili 和可维护的学校/学院页面中使用统一官网链接，有助于访客找到准确入口。

## 4. 验证与回归

普通逻辑测试：

```bash
npx vitest run tests/site-seo.test.ts tests/seo-feeds.test.ts
npm run typecheck
npm run build
```

真实数据库权限回归使用 `tests/v2-public-content-shadow.integration.test.ts`，必须提供数据库名
含独立 `test` 段、且不同于应用数据库的 `TEST_DATABASE_URL`。

生产构建 HTTP 测试为 `tests/site-seo.http.integration.test.ts`。先在隔离 PostgreSQL 中迁移，
然后用生产构建启动仅监听回环的应用，设置：

- `DATABASE_URL` 指向隔离数据库。
- `NUXT_PUBLIC_SITE_URL=https://seo-runtime.example`。
- `NUXT_PUBLIC_BAIDU_SITE_VERIFICATION=seo-verification-test`。
- `CMS_AUTH_SECRET` 使用至少 32 字符的测试专用值，`CMS_SECURE_COOKIES=false`。

在另一个终端用相同测试数据库设置 `TEST_DATABASE_URL`、相同测试 secret，执行：

```bash
SEO_TEST_BASE_URL=http://127.0.0.1:测试端口 npx vitest run tests/site-seo.http.integration.test.ts
```

测试会先核对运行中的测试域名，随后仅创建、删除自身的文章与账号。覆盖九个核心页面的原始
HTML 元数据、运行时站点验证、新闻/Wiki 正文、结构化数据、匿名/登录 Feed 排除、受限详情
登录回跳与 noindex、后台/占位页、真实 HTML 404 和永久旧入口跳转。结束后停止临时应用并删除
本次创建的测试容器。

## 5. P2 自动推送的接入边界

本轮提供验证标签和公开清单，尚未启用自动 API 推送。P2 需要已验证站点、平台实际开放的普通
收录 API 与服务端 Token，工作量主要来自可靠运行，而非发出 HTTP 请求。

后续可增加独立运维任务：按公开网址与版本时间判断新增/更新，分批提交，记录成功结果和剩余
配额，对临时失败退避重试。发送前重新核对公开权限；缺少 Token 默认关闭，Token 不进入
`runtimeConfig.public`、客户端、URL清单或日志。失败不阻塞 CMS 发布，不改变内容导出任务的语义。
普通收录推送是数据提交，不应把“成功推送条数”标为“成功收录条数”。

官方说明：[百度标题规范](https://ziyuan.baidu.com/college/articleinfo?id=2728)、
[百度普通收录](https://ziyuan.baidu.com/college/courseinfo?id=267&page=2)、
[提交不保证收录](https://ziyuan.baidu.com/wiki/132)、
[noindex 与抓取的区别](https://developers.google.com/search/docs/crawling-indexing/block-indexing)。
