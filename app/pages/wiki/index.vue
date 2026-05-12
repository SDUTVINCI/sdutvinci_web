<script setup lang="ts">
interface WikiMetaItem {
  path: string
  date?: string
  docKey?: string
  isWikiDoc?: boolean
}

useHead({
  title: 'Wiki | 山东理工大学 Vinci 机器人队'
})

const { data: wikiMeta } = await useAsyncData<WikiMetaItem[]>('wiki:index-stats', () =>
  queryCollection('wiki')
    .select('path', 'date', 'docKey', 'isWikiDoc')
    .all() as Promise<WikiMetaItem[]>
)

const wikiPages = computed(() => (wikiMeta.value ?? []).filter((item) => item.isWikiDoc))

const wikiStats = computed(() => {
  const docs = new Set(wikiPages.value.map((item) => item.docKey).filter(Boolean))
  const latestDate = wikiPages.value
    .map((item) => item.date)
    .filter(Boolean)
    .sort((a, b) => String(b).localeCompare(String(a)))[0]

  return [
    { value: docs.size, label: '教程文档' },
    { value: wikiPages.value.length, label: '页面与章节' },
    { value: latestDate || '持续整理', label: '最近文档日期' }
  ]
})
</script>

<template>
  <main>
    <section class="page-hero wiki-hero">
      <div>
        <p class="eyebrow">Knowledge Base</p>
        <h1>Wiki 知识库</h1>
        <p>
          汇集团队工程实践中的教程、环境配置、机器人开发资料和长期沉淀的学习笔记。
        </p>
      </div>
    </section>

    <section class="stats-band research-stats" aria-label="Wiki 概览">
      <div v-for="item in wikiStats" :key="item.label" class="stat-item">
        <strong>{{ item.value }}</strong>
        <span>{{ item.label }}</span>
      </div>
    </section>

    <section class="wiki-section">
      <div class="section-heading wiki-section-heading">
        <p class="eyebrow">Docs</p>
        <h2>知识目录</h2>
      </div>

      <WikiList />
    </section>
  </main>
</template>
