<script setup lang="ts">
import { footerPartnerGroups } from '~/data/footer-partners'

const footerPartners = footerPartnerGroups.flatMap(group =>
  group.items.map(item => ({ ...item, groupId: group.id }))
)
</script>

<template>
  <footer class="site-footer">
    <div class="footer-inner">
      <div class="footer-main">
        <div class="footer-brand">
          <img src="https://cdn.sdutvincirobot.top/site-assets/images/logo_black-e355a71c.webp" alt="Vinci 机器人队标志">
          <div>
            <strong>山东理工大学 Vinci 机器人队</strong>
            <span>以 Robocon 为核心的机器人创新团队</span>
          </div>
        </div>

        <div class="footer-links">
          <a href="mailto:sdutvincirobot@foxmail.com">邮箱</a>
          <a href="https://github.com/SDUTVINCI" target="_blank" rel="noopener noreferrer">GitHub</a>
          <a href="https://space.bilibili.com/471524675" target="_blank" rel="noopener noreferrer">Bilibili</a>
          <a href="https://mp.weixin.qq.com/s/AAPWX2zOhJjA-s2MA-g2Ew" target="_blank" rel="noopener noreferrer">微信公众号</a>
        </div>
      </div>

      <section class="footer-partners" aria-labelledby="footer-partners-title">
        <header class="footer-partners-heading">
          <div>
            <p class="eyebrow">PARTNERS & SUPPORT</p>
            <h2 id="footer-partners-title">合作与支持</h2>
            <p>感谢学校、赛事平台与合作伙伴对 Vinci 机器人队发展的支持。</p>
          </div>
          <NuxtLink class="footer-partners-contact" to="/contact">合作洽谈 <span aria-hidden="true">→</span></NuxtLink>
        </header>

        <div
          class="footer-partner-marquee"
          aria-label="合作单位与合作伙伴"
        >
          <div class="footer-partner-track">
            <div
              v-for="copyIndex in 2"
              :key="copyIndex"
              class="footer-partner-set"
              :role="copyIndex === 1 ? 'list' : undefined"
              :aria-hidden="copyIndex === 2 ? 'true' : undefined"
            >
              <a
                v-for="item in footerPartners"
                :key="item.name"
                :class="['footer-partner-card', `footer-partner-card-${item.groupId}`]"
                :role="copyIndex === 1 ? 'listitem' : undefined"
                :tabindex="copyIndex === 2 ? -1 : undefined"
                :href="item.href"
                target="_blank"
                rel="noopener noreferrer"
                :aria-label="`访问${item.name}官网`"
              >
                <span class="footer-partner-logo">
                  <img :class="item.logoClass" :src="item.logo" :alt="`${item.name} Logo`" loading="lazy" decoding="async">
                </span>
                <span class="footer-partner-copy">
                  <strong>{{ item.name }}</strong>
                  <small>{{ item.role }}</small>
                </span>
                <span class="footer-partner-arrow" aria-hidden="true">↗</span>
              </a>
            </div>
          </div>
        </div>
      </section>

      <div class="footer-records">
        <span class="footer-copyright">© 2026 山东理工大学 Vinci 机器人队</span>
        <a href="https://beian.miit.gov.cn" target="_blank" rel="noopener noreferrer">
          <img
            class="footer-record-icon"
            src="https://cdn.tungchiahui.cn/tungwebsite/assets/images/footer/favicon-miit.webp"
            alt=""
            aria-hidden="true"
          >
          鲁ICP备2025185601号-1
        </a>
        <a
          href="http://www.beian.gov.cn/portal/registerSystemInfo?recordcode=37030302001123"
          target="_blank"
          rel="noopener noreferrer"
        >
          <img
            class="footer-record-icon"
            src="https://cdn.tungchiahui.cn/tungwebsite/assets/images/footer/favicon-mps.webp"
            alt=""
            aria-hidden="true"
          >
          鲁公网安备37030302001123号
        </a>
      </div>
    </div>
  </footer>
</template>
