<script setup lang="ts">
import type { PublicRestrictedWikiDocument } from '~~/shared/types/public-content'

interface WikiMetaItem {
  path: string
  date?: string
  docKey?: string
  isWikiDoc?: boolean
}

interface WikiIndexResponse {
  items: WikiMetaItem[]
  restrictedDocuments: PublicRestrictedWikiDocument[]
}

const { data: wikiResponse } = await usePublicContentQuery<WikiIndexResponse>({
  key: 'wiki:index-stats',
  database: requestFetch => requestFetch<WikiIndexResponse>('/api/v2/content/wiki')
})

useContentSeo({
  title: 'Wiki | 山东理工大学 Vinci 机器人队',
  description: 'Vinci 机器人队工程实践、环境配置、机器人开发资料与学习笔记。',
  path: '/wiki'
})

const wikiPages = computed(() => (
  wikiResponse.value?.items ?? []
).filter((item) => item.isWikiDoc))

const wikiStats = computed(() => {
  const docs = new Set(wikiPages.value.map((item) => item.docKey).filter(Boolean))
  for (const doc of wikiResponse.value?.restrictedDocuments ?? []) {
    docs.add(doc.docKey)
  }
  const latestDate = wikiPages.value
    .map((item) => item.date)
    .filter(Boolean)
    .sort((a, b) => String(b).localeCompare(String(a)))[0]

  return [
    { index: '01', value: docs.size, label: '教程文档' },
    { index: '02', value: wikiPages.value.length, label: '可浏览页面与章节' },
    { index: '03', value: latestDate || '持续整理', label: '最近文档日期' }
  ]
})
</script>

<template>
  <main class="wiki-index-page">
    <section class="page-hero wiki-hero">
      <div class="wiki-hero-copy">
        <p class="eyebrow">Knowledge Base</p>
        <h1>Wiki 知识库</h1>
        <p>
          汇集团队工程实践中的教程、环境配置、机器人开发资料和长期沉淀的学习笔记。
        </p>
        <div class="wiki-hero-tags" aria-label="知识库内容方向">
          <span>机器人开发</span>
          <span>工程环境</span>
          <span>竞赛实践</span>
        </div>
      </div>
    </section>

    <section class="wiki-overview" aria-label="Wiki 概览">
      <div v-for="item in wikiStats" :key="item.label" class="wiki-overview-item">
        <span>{{ item.index }}</span>
        <div>
          <strong>{{ item.value }}</strong>
          <small>{{ item.label }}</small>
        </div>
      </div>
    </section>

    <section class="wiki-section">
      <div class="wiki-section-heading">
        <div>
          <p class="eyebrow">Knowledge Directory</p>
          <h2>探索知识库</h2>
        </div>
        <p>按文档浏览公开教程；成员资料和部分受限内容会明确标注，登录后即可继续阅读。</p>
      </div>

      <WikiList />
    </section>
  </main>
</template>
