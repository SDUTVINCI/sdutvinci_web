<script setup lang="ts">
import OrganizationGalaxyBackground from '../../components/OrganizationGalaxyBackground.vue'
import type { PublicOrganizationResponse } from '../../../shared/types/organization'

const requestFetch = import.meta.server ? useRequestFetch() : $fetch
const { data, error, pending, refresh } = await useAsyncData('organization:public', () =>
  requestFetch<PublicOrganizationResponse>('/api/organization'),
  { lazy: true }
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

    <section class="organization-page-content">
      <PublicContentState
        v-if="pending || error || !data"
        :pending="pending"
        :error="Boolean(error)"
        loading-message="正在加载组织架构…"
        error-message="组织架构暂时无法加载，请稍后重试。"
        empty-message="暂时没有发布的组织架构。"
        @retry="refresh()"
      />
      <template v-else>
        <OrganizationChart :structure="data.structure" />
        <footer class="organization-update-note">
          <span>LAST PUBLISHED</span>
          <p>本页只描述组织关系，不关联成员档案；架构调整以后台最新发布版本为准。</p>
          <time :datetime="data.publishedAt">版本 {{ data.publishedVersion }}</time>
        </footer>
      </template>
    </section>
  </main>
</template>
