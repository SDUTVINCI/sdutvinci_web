import { existsSync, readdirSync } from 'node:fs'
import { basename } from 'node:path'
import { getWikiContentMeta } from './utils/wiki-content-meta'

const memberRoutes = existsSync('content/members')
  ? readdirSync('content/members')
    .filter((file) => file.endsWith('.md'))
    .map((file) => `/team/${basename(file, '.md')}`)
  : []

export default defineNuxtConfig({
  modules: ['@nuxt/content'],
  compatibilityDate: '2026-05-12',
  css: ['~/assets/css/main.css'],
  content: {
    build: {
      transformers: ['./transformers/wiki-pinyin-path.ts']
    }
  },
  mdc: {
    highlight: {
      theme: {
        default: 'github-light',
        dark: 'github-dark'
      },
      langs: [
        'ts',
        'js',
        'vue',
        'json',
        'bash',
        'md',
        'html',
        'css',
        'scss',
        'python',
        'py',
        'java',
        'cmake',
        'cpp',
        'c',
        'csharp',
        'go',
        'rust',
        'php',
        'sql',
        'yaml',
        'yml',
        'xml',
        'toml',
        'docker',
        'dockerfile',
        'kotlin',
        'swift',
        'ruby',
        'dart',
        'lua',
        'perl',
        'r',
        'zig'
      ]
    }
  },
  hooks: {
    'content:file:afterParse'({ content }) {
      const wikiMeta = getWikiContentMeta(content.stem)

      if (wikiMeta) {
        Object.assign(content, wikiMeta)
      }
    }
  },
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
          href: '/images/logo.png'
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
  routeRules: {
    '/': { prerender: true },
    '/research': { prerender: true },
    '/team': { prerender: true },
    '/team/**': { prerender: true },
    '/news': { prerender: true },
    '/news/**': { prerender: true },
    '/wiki': { prerender: true },
    '/wiki/**': { prerender: true },
    '/docs': { redirect: '/wiki' },
    '/recruitment': { prerender: true },
    '/contact': { prerender: true }
  },
  nitro: {
    prerender: {
      crawlLinks: true,
      routes: ['/', '/research', '/team', '/news', '/wiki', '/recruitment', '/contact', ...memberRoutes]
    }
  }
})
