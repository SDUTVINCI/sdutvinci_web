export default defineNuxtConfig({
  modules: ['@comark/nuxt'],
  compatibilityDate: '2026-05-12',
  css: ['~/assets/css/main.css'],
  app: {
    head: {
      htmlAttrs: {
        lang: 'zh-CN'
      },
      title: '山东理工大学 Vinci 机器人队',
      meta: [
        {
          name: 'description',
          content: '山东理工大学 Vinci 机器人队官网，展示 Robocon 战队介绍、成果与招新信息。'
        },
        {
          name: 'viewport',
          content: 'width=device-width, initial-scale=1'
        }
      ],
      link: [
        {
          rel: 'icon',
          href: '/favicon.ico',
          sizes: 'any'
        },
        {
          rel: 'icon',
          type: 'image/png',
          href: 'https://cdn.sdutvincirobot.top/site-assets/images/logo-e355a71c.webp'
        }
      ],
      script: [
        {
          key: 'theme-init',
          innerHTML: "(() => { try { const stored = localStorage.getItem('vinci-theme'); const theme = stored === 'light' || stored === 'dark' ? stored : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); document.documentElement.dataset.theme = theme; } catch (_) {} })()"
        },
        {
          defer: true,
          src: 'https://umami.tungchiahui.cn/script.js',
          'data-website-id': 'fbf6736a-20c1-4fe9-8a24-4e0600b24903'
        }
      ]
    }
  },
  runtimeConfig: {
    public: {
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL || ''
    }
  },
  routeRules: {
    '/': { prerender: false },
    '/research': { prerender: true },
    '/team': { prerender: false },
    '/team/**': { prerender: false },
    '/news': { prerender: false },
    '/news/**': { prerender: false },
    '/wiki': { prerender: false },
    '/wiki/**': { prerender: false },
    '/docs': { redirect: '/wiki' },
    '/recruitment': { prerender: true },
    '/contact': { prerender: true },
    '/cms/**': { prerender: false },
    '/api/cms/**': { prerender: false },
    '/api/v2/**': { prerender: false },
    '/sitemap.xml': { prerender: false },
    '/rss.xml': { prerender: false }
  },
  nitro: {
    prerender: {
      crawlLinks: true,
      routes: ['/research', '/projects', '/recruitment', '/contact']
    }
  }
})
