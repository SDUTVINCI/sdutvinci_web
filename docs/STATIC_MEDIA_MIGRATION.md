# 仓库静态媒体迁移到 CDN

## 1. 两类对象必须分开

CMS 编辑器粘贴、拖入或选择的图片由服务端转换并登记到 `media_assets`，对象 key 为：

```text
<S3_KEY_PREFIX>/<collection>/<文章创建年>/<月>/<日>/<Unix毫秒>-<最终WebP的SHA-256前8位>.webp
```

默认 `S3_KEY_PREFIX=site-assets/images`，例如 Wiki 图片对象为
`site-assets/images/wiki/2025/02/07/1700000000000-a3f91c2e.webp`。已有文章取稳定的
文章目录或新闻文件名开头的日期，尚无路径时取 `publishedAt`（明确覆盖值优先），最后回退到
草稿创建日。文件名规则不变。这里的图片仍与草稿、上传者、编辑锁和数据库记录关联；不要手动
把站点静态素材塞进该目录。

代码仓库原有图片和首页视频使用独立、可人工管理的目录：

```text
site-assets/images/**
site-assets/videos/**
```

静态资源文件名保留原可读名称，并追加最终文件 SHA-256 的前 8 位。内容变化时 URL 也会变化，
因此可以安全使用长期 immutable 缓存。

## 2. 生成上传包

前置条件：已执行 `npm ci`。脚本只使用 Sharp 转换图片，并原样复制首页 MP4；不需要 FFmpeg
或 Docker。它不读取数据库、S3 凭据或生产配置，也不会上传、删除或改写媒体源目录。迁移前
源目录是 `public/images`，因此当时使用：

```bash
npm run media:prepare
```

迁移完成后 `public/images` 已从当前工作树移除。如需从 Git 历史中恢复原媒体并复现上传包，先
把它们导出到一个临时目录，再显式传入只读源目录；不要恢复 Nuxt Content 的 `content/`：

```bash
npm run media:prepare -- --source /明确路径/restore-public-images
```

默认输出为仓库根目录下不纳入 Git 的 `cdn-upload/`：

```text
cdn-upload/
├── site-assets/             # 唯一需要上传的目录
│   ├── images/
│   └── videos/
├── manifest.json            # 旧路径、对象 key、URL、尺寸、大小和 SHA-256
├── manifest.csv
└── UPLOAD_INSTRUCTIONS.md
```

如果该目录已存在，脚本会拒绝覆盖。先人工移动旧输出，再重新生成；不要用宽泛递归删除命令。

## 3. 转换策略

- JPEG 等照片按真实解码格式转 WebP，quality 85、effort 6，最长边不超过 2560，且不放大。
- 真正的 PNG 使用无损 WebP，保留透明通道；扩展名写错但内容为 JPEG 的文件按照片处理。
- 已经是 WebP 的文件保留原始字节，避免无意义的二次有损编码。
- 首页 MP4 不压缩、不转码、不移除音轨，按原始字节复制，只给文件名追加内容哈希。
- 每张图片都会再次解码校验；所有输出都写入完整 SHA-256 和转换前后大小。

## 4. 手动上传

把整个 `cdn-upload/site-assets` 文件夹上传到 Bucket 根目录，最终公开地址应为：

```text
https://cdn.sdutvincirobot.top/site-assets/images/...
https://cdn.sdutvincirobot.top/site-assets/videos/...
```

建议对象元数据：

| 类型 | Content-Type | Cache-Control |
| --- | --- | --- |
| WebP | `image/webp` | `public, max-age=31536000, immutable` |
| 原始 MP4 | `video/mp4` | `public, max-age=31536000, immutable` |

视频对象还应支持 Range 请求。`manifest.json`、`manifest.csv` 和说明文件只供本地核对，
不需要上传。

## 5. 上传后的切换与回滚

上传完成后先逐项检查公开 URL、Content-Type、Content-Length、图片解码和视频 Range 请求，
再更新网站代码引用。数据库中的旧 `/images/...` 可通过确定性清单在渲染时映射，不直接批量
改写 PostgreSQL 正文。独立内容仓库中的 32 个成员头像和新闻正文 10 个唯一对象另通过
`sdutvinci_content` Draft PR #1 改为 CDN URL，等待既有审核/导入流程更新权威数据库；Wiki
现有旧 CDN 引用不在本次迁移范围内。

CDN 校验和本机页面测试完成前保留 `public/images`。校验通过后，网站通过
`shared/utils/static-media.ts` 将已有正文、成员资料中的登记旧路径映射到 CDN；未登记的
`/images/...` 保持原样。内容仓库的 URL 更新与正式数据库导入仍走独立 PR，不从网站运行时
反向写 Markdown。随后可从工作树移除已迁移媒体，如果 CDN 异常则可从 Git 历史恢复。不要
删除数据库 `media_assets` 记录掩盖对象缺失。

本流程不负责上传对象、修改生产数据库、部署或清理生产服务器。
