# 首页赞助与合作伙伴维护

首页底部先展示山东理工大学、机电创新学会、智能机器人创新实践基地和 ROBOCON，再展示
赞助与合作伙伴。页脚的“合作与支持”轮播也会显示同一批赞助与合作伙伴。

赞助名单只在 `app/data/footer-partners.ts` 的 `sponsorPartners` 数组维护。新增一项时填写：

```ts
{
  name: '对外展示名称',
  role: '赞助商',
  logo: sponsorAsset('文件名.webp'),
  href: 'https://官网地址/',
  logoClass: 'footer-partner-logo-wordmark'
}
```

- `role` 按实际关系填写“赞助商”或“合作伙伴”，不要将高校、社团、实践基地或赛事填入此名单。
- Logo 使用透明背景图片，建议先上传至 `cdn.sdutvinci.cn/site-assets/images/sponsors/`。
- 横向文字标志可使用 `footer-partner-logo-wordmark`；圆形或方形标志可使用
  `footer-partner-logo-symbol`。首页图片会按自身比例缩放，不裁切。
- `href` 填官网或经确认的官方介绍页，卡片整体可点击。
- 数组顺序决定首页排列顺序和页脚轮播顺序。

本次新增的 8 个 Logo 文件已统一为以下名称；上传对象存储时保留文件名，目标目录为
`site-assets/images/sponsors/`，公开访问地址为
`https://cdn.sdutvinci.cn/site-assets/images/sponsors/<文件名>`。

| 赞助商 | 文件名 |
| --- | --- |
| 大疆创新 DJI | `dji-logo.webp` |
| 萝马车圈 | `roma-club-logo.webp` |
| 超核电子 HiPNUC | `hipnuc-logo.webp` |
| 嘉立创 | `jlc-logo.webp` |
| 臻碳工坊 | `zhentan-workshop-logo.webp` |
| 格瑞普电池 GREPOW | `grepow-logo.webp` |
| MPS 芯源系统 | `mps-logo.webp` |
| 创芯工坊 | `icworkshop-logo.webp` |

臻碳工坊目前使用其 B 站账号主页和头像。`techcarbonworks.com` 网站自称属于另一家企业，
未用于该赞助商。上传全部 8 个文件并逐一确认公开访问返回 `image/webp` 后，再发布引用这些地址的前端代码。CDN 对不存在的对象也可能返回 HTTP 200，但内容是报错 JSON，不能只看状态码。
本次新增文件的前端地址附加 `?v=20260930`，用于避开上传前缓存的错误响应；对象存储中的文件名不包含查询参数。

每次更新后运行 `npm run typecheck`、`npx vitest run tests/site-footer-partners.test.ts` 和
`npm run build`，再检查首页桌面、手机视宽及深浅色主题的 Logo 清晰度。
