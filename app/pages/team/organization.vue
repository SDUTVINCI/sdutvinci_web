<script setup lang="ts">
import OrganizationGalaxyBackground from '../../components/OrganizationGalaxyBackground.vue'
import type { PublicOrganizationResponse } from '../../../shared/types/organization'

const requestFetch = import.meta.server ? useRequestFetch() : $fetch
const { data, error } = await useAsyncData('organization:public', () =>
  requestFetch<PublicOrganizationResponse>('/api/organization')
)

useContentSeo({
  title: '组织架构 | 山东理工大学 Vinci 机器人队',
  description: '查看 Vinci 机器人队与机电创新学会当前组织架构。',
  path: '/team/organization'
})
</script>

<template>
  <main class="organization-page">
    <OrganizationGalaxyBackground />

    <section class="organization-hero">
      <div>
        <p class="eyebrow">Team structure</p>
        <h1>{{ data?.structure.title || '当前组织架构' }}</h1>
        <p>{{ data?.structure.description || '展示团队当前采用的组织结构。' }}</p>
      </div>
      <div class="organization-current-mark">
        <span aria-hidden="true" />
        <strong>当前版本</strong>
        <small>只展示最新架构</small>
      </div>
    </section>

    <TeamSectionNav />

    <section v-if="data" class="organization-page-content">
      <OrganizationChart :structure="data.structure" />
      <footer class="organization-update-note">
        <span>LAST PUBLISHED</span>
        <p>本页只描述组织关系，不关联成员档案；架构调整以后台最新发布版本为准。</p>
        <time :datetime="data.publishedAt">版本 {{ data.publishedVersion }}</time>
      </footer>
    </section>
    <p v-else-if="error" class="organization-load-error">组织架构暂时无法加载，请稍后重试。</p>
  </main>
</template>
