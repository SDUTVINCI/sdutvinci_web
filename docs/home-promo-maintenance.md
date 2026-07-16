# 首页宣传轮播维护

首页轮播内容统一维护在 `app/data/home-promos.ts`，页面结构和交互逻辑不需要随内容修改。

## 新增或调整宣传页

在 `homePromoSlides` 数组中新增、删除或移动一个对象即可。数组顺序就是轮播顺序。

```ts
{
  kicker: '顶部小标题',
  title: '宣传主标题',
  highlight: '需要强调的标题文字',
  summary: '一到两句摘要',
  image: '/images/example.jpg',
  imageAlt: '图片内容说明',
  href: '/目标页面',
  cta: '按钮文字',
  tone: 'victory',
  position: 'center 50%'
}
```

- `image`：图片先放进 `public/images`，这里填写以 `/images` 开头的访问路径。
- `highlight`：可选，填写标题中需要放大并使用强调色的连续文字。
- `imageAlt`：简要说明图片内容，供无障碍阅读和图片加载失败时使用。
- `href`：整张宣传页点击后的站内地址。
- `tone`：可选 `victory`、`recruitment`、`team`，分别对应红、绿、蓝三种强调色。
- `position`：可选，用于调整图片裁切中心，例如 `center 60%`。

自动轮播间隔由同一文件中的 `homePromoAutoplayMs` 控制，单位为毫秒。

交互代码在 `app/components/HomePromoCarousel.vue`，视觉样式在 `app/assets/css/home.css`。日常更新文案、图片和链接时不需要修改这两个文件。
