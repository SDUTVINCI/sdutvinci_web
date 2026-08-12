# CMS 文章媒体日期路径

## 1. 用户能够做什么

- 在 CMS 编辑新闻或 Wiki 草稿时，继续通过选择、粘贴或拖入图片上传。
- 上传图片仍转换为 WebP，文件名继续使用既有的
  `<Unix毫秒>-<最终WebP的SHA-256前8位>.webp`，只改变目录层级。
- Wiki 图片写入 `site-assets/images/wiki/YYYY/MM/DD/`；新闻图片写入对应的
  `site-assets/images/news/YYYY/MM/DD/`。
- 飞书 Wiki 本地待上传包使用同样的 `wiki/YYYY/MM/DD/` 目录；图片转 WebP，但文件名沿用
  导入工具当前规则。非图片附件保持原文件名和格式。
- 内容 PR 中所有 Wiki 的 `publishedAt` 按最外层目录日期统一写成 UTC 午夜，例如
  `2025-02-07T00:00:00.000Z`。

## 2. 页面和 API 应返回什么

- `POST /api/cms/media` 的请求字段不变，成功响应仍返回 `asset` 与可直接插入正文的 `markdown`。
- `asset.url` 由部署环境配置的 `S3_PUBLIC_BASE_URL` 加对象 key 构成；该变量没有写死。
  例如公开基址配置为 `https://cdn.sdutvincirobot.top` 时，Wiki 图片 URL 形如
  `https://cdn.sdutvincirobot.top/site-assets/images/wiki/2025/02/07/<文件名>.webp`。
- 已有文章优先读取 Wiki 目录或新闻文件名开头的 `YYYY-MM-DD`，与内容仓库结构一致；尚无路径
  时使用 `publishedAt`（明确覆盖值优先），再回退到草稿创建日。因此同一草稿后续编辑仍在同一
  日期目录。

## 3. 权限、安全和异常情况

- 上传继续要求登录、CSRF、限流、草稿所有权、有效编辑锁与 `draft` 状态；管理员边界不变。
- 服务端继续校验真实图片格式、大小和像素，统一转 WebP；浏览器不会获得对象存储凭据。
- 对象上传失败不写 `media_assets`；上传后编辑锁失效时尽力删除刚写入对象。
- `S3_KEY_PREFIX` 仍只接受安全路径段，不能包含 `.`、`..`、空段或首尾斜杠。

## 4. 明确不需要实现的内容

- 不迁移或重命名已经存在的对象，不修改历史 `media_assets.public_url`。
- 不改变 CMS 图片文件名，不为非图片附件增加 CMS 上传入口。
- 不新增 Migration，不恢复代码仓库 `content/`，不引入 Nuxt Content。
- 不修改 `utils/wiki-content-meta.ts` 或 `utils/wiki-chapters.ts`，不改变 Wiki 拼音路径。
- 不上传飞书媒体包，不 Push、不部署、不连接生产 PostgreSQL、S3/COS 或服务器。

## 5. 本地验收

```bash
./scripts/cms-local-test.sh start
```

打开 `http://127.0.0.1:3300/cms/login`，使用本地测试管理员进入任意 Wiki 草稿并上传一张图片。
返回 URL 应包含 `/site-assets/images/wiki/YYYY/MM/DD/`，文件名仍为 Unix 毫秒与哈希。
自动化测试必须使用另一个名称明确含 `test` 的隔离数据库，不能清理人工验收库。
