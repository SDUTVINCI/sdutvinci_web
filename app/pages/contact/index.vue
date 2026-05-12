<script setup lang="ts">
useHead({
  title: '联系 | 山东理工大学 Vinci 机器人队'
})

const contactCards = [
  {
    title: '邮箱',
    value: 'sdutvincirobot@foxmail.com',
    text: '适合招新咨询、校园事务、网站信息修正等联系。',
    href: 'mailto:sdutvincirobot@foxmail.com'
  },
  {
    title: '实验室地址',
    value: '山东理工大学智能机器人创新实践基地',
    text: '山东省淄博市张店区山东理工大学西校区大红炉',
    href: 'https://www.amap.com/place/B0FFHY7KRG'
  },
  {
    title: '合作微信',
    value: 'sdut_vincirobot',
    text: '企业赞助、项目合作或赛事交流事务可通过微信沟通。',
    href: ''
  }
]

const socialLinks = [
  { label: 'GitHub', href: 'https://github.com/SDUTVINCI' },
  { label: 'Bilibili', href: 'https://space.bilibili.com/471524675' },
  { label: '微信公众号', href: 'https://mp.weixin.qq.com/s/AAPWX2zOhJjA-s2MA-g2Ew' }
]
</script>

<template>
  <main>
    <section class="page-hero contact-hero">
      <div>
        <p class="eyebrow">Contact Us</p>
        <h1>联系我们</h1>
        <p>
          机电创新学会、Vinci 机器人队欢迎热爱机器人的同学加入，也欢迎企业、校内外团队与我们交流合作。
        </p>
      </div>
    </section>

    <section class="contact-overview">
      <div class="contact-lead">
        <p class="eyebrow">SDUT Vinci</p>
        <h2>找到我们，或者先发一封邮件</h2>
        <p>
          我们位于山东理工大学智能机器人创新实践基地。招新、合作、赛事交流和官网信息反馈，都可以通过下面的方式联系。
        </p>
        <div class="join-actions">
          <a class="action-button primary" href="mailto:sdutvincirobot@foxmail.com">发送邮件</a>
          <a
            class="action-button"
            href="https://www.amap.com/place/B0FFHY7KRG"
            target="_blank"
            rel="noopener noreferrer"
          >
            查看位置
          </a>
        </div>
      </div>

      <div class="contact-visual">
        <img src="/images/cooporate.jpg" alt="Vinci 机器人队合作交流展示">
      </div>
    </section>

    <section class="contact-card-grid" aria-label="联系方式">
      <article v-for="card in contactCards" :key="card.title" class="contact-card">
        <span>{{ card.title }}</span>
        <a
          v-if="card.href"
          :href="card.href"
          :target="card.href.startsWith('http') ? '_blank' : undefined"
          :rel="card.href.startsWith('http') ? 'noopener noreferrer' : undefined"
        >
          {{ card.value }}
        </a>
        <strong v-else>{{ card.value }}</strong>
        <p>{{ card.text }}</p>
      </article>
    </section>

    <section class="contact-section">
      <div class="section-heading">
        <p class="eyebrow">Online</p>
        <h2>线上入口</h2>
      </div>

      <div class="social-strip">
        <a
          v-for="link in socialLinks"
          :key="link.label"
          :href="link.href"
          target="_blank"
          rel="noopener noreferrer"
        >
          {{ link.label }}
        </a>
      </div>
    </section>

    <section class="analytics-section">
      <div class="section-heading">
        <p class="eyebrow">网站数据</p>
        <h2>访问统计</h2>
      </div>

      <iframe
        class="analytics-frame"
        src="https://umami.tungchiahui.cn/share/JlYvq49pa9OzuAma"
        loading="lazy"
        title="Vinci 官网网站统计"
      />
    </section>
  </main>
</template>
