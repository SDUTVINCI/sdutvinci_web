<script setup lang="ts">
useHead({
  title: '常用链接 | 山东理工大学 Vinci 机器人队',
  meta: [
    { name: 'description', content: '山东理工大学 Vinci 机器人队资料与相关服务入口汇总。' }
  ]
})

const groups = [
  {
    title: '资料与文件',
    links: [
      { name: '资料下载', href: '/downloads', domain: 'vinci.sdut.edu.cn/downloads', description: '浏览公开资料与文件', external: false },
      { name: '下载站', href: 'https://dl.sdutvinci.cn', domain: 'dl.sdutvinci.cn', description: '查看原始文件目录', external: true },
      { name: 'AList', href: 'https://alist.sdutvinci.cn', domain: 'alist.sdutvinci.cn', description: '文件管理入口', external: true }
    ]
  },
  {
    title: '数据与管理',
    links: [
      { name: '访问统计', href: 'https://umami.sdutvinci.cn', domain: 'umami.sdutvinci.cn', description: '网站访问数据', external: true },
      { name: '对象存储', href: 'https://s3.sdutvinci.cn', domain: 's3.sdutvinci.cn', description: 'S3 服务入口', external: true },
      { name: '1Panel', href: 'https://1panel.sdutvinci.cn', domain: '1panel.sdutvinci.cn', description: '服务器管理入口', external: true }
    ]
  }
]
</script>

<template>
  <main>
    <section class="page-hero links-hero">
      <div>
        <p class="eyebrow">VINCI LINKS</p>
        <h1>常用链接</h1>
        <p>在这里找到公开资料与相关服务入口。</p>
      </div>
    </section>

    <section class="links-section" aria-labelledby="links-title">
      <div class="section-heading">
        <p class="eyebrow">Quick Access</p>
        <h2 id="links-title">站点导航</h2>
        <p>部分服务需要单独登录；站外链接将在新标签页打开。</p>
      </div>

      <section v-for="group in groups" :key="group.title" class="links-group" :aria-label="group.title">
        <h3>{{ group.title }}</h3>
        <div class="links-grid">
          <template v-for="link in group.links" :key="link.href">
            <NuxtLink
              v-if="!link.external"
              class="links-card"
              :to="link.href"
              :aria-label="`访问${link.name}`"
            >
              <span class="links-card-top">
                <span class="links-card-name">{{ link.name }}</span>
                <span class="links-card-arrow" aria-hidden="true">→</span>
              </span>
              <strong>{{ link.domain }}</strong>
              <span class="links-card-description">{{ link.description }}</span>
            </NuxtLink>
            <a
              v-else
              class="links-card"
              :href="link.href"
              target="_blank"
              rel="noopener noreferrer"
              :aria-label="`访问${link.name}：${link.domain}，在新标签页打开`"
            >
              <span class="links-card-top">
                <span class="links-card-name">{{ link.name }}</span>
                <span class="links-card-arrow" aria-hidden="true">↗</span>
              </span>
              <strong>{{ link.domain }}</strong>
              <span class="links-card-description">{{ link.description }}</span>
            </a>
          </template>
        </div>
      </section>
    </section>
  </main>
</template>

<style scoped>
.links-hero {
  background:
    linear-gradient(90deg, rgba(14, 26, 32, 0.92), rgba(14, 26, 32, 0.56)),
    url('https://cdn.sdutvinci.cn/site-assets/images/background_footer-03b5c48e.webp') center / cover;
}

.links-section {
  width: min(var(--content), calc(100% - 48px));
  margin: 76px auto 96px;
}

.links-section .section-heading > p:last-child {
  margin-top: 12px;
  color: var(--ink-soft);
}

.links-group {
  margin-top: 34px;
}

.links-group h3 {
  margin: 0;
  color: var(--ink);
  font-size: 1.2rem;
}

.links-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin-top: 16px;
}

.links-card {
  display: grid;
  align-content: start;
  gap: 14px;
  min-height: 190px;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 24px;
  background: var(--surface);
  color: var(--ink);
  box-shadow: var(--shadow-card);
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}

.links-card:hover,
.links-card:focus-visible {
  transform: translateY(-3px);
  border-color: var(--cyan);
  box-shadow: var(--shadow-hover);
}

.links-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.links-card-name {
  color: var(--cyan);
  font-size: 0.9rem;
  font-weight: 800;
}

.links-card-arrow {
  color: var(--red-dark);
  font-size: 1.45rem;
  line-height: 1;
}

.links-card strong {
  overflow-wrap: anywhere;
  font-size: 1.16rem;
  line-height: 1.3;
}

.links-card-description {
  color: var(--ink-soft);
  font-size: 0.92rem;
}

@media (max-width: 920px) {
  .links-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 620px) {
  .links-section {
    margin: 52px auto 72px;
  }

  .links-grid {
    grid-template-columns: 1fr;
  }
}
</style>
