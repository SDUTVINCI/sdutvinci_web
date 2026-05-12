import { existsSync, readdirSync } from 'node:fs'
import { basename } from 'node:path'

const memberRoutes = existsSync('content/members')
  ? readdirSync('content/members')
    .filter((file) => file.endsWith('.md'))
    .map((file) => `/team/${basename(file, '.md')}`)
  : []

export default defineNuxtConfig({
  modules: ['@nuxt/content'],
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
          href: '/images/logo.png'
        }
      ]
    }
  },
  routeRules: {
    '/': { prerender: true },
    '/research': { prerender: true },
    '/team': { prerender: true },
    '/team/**': { prerender: true }
  },
  nitro: {
    prerender: {
      crawlLinks: false,
      routes: ['/', '/research', '/team', ...memberRoutes]
    }
  }
})
