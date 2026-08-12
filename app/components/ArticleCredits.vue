<script setup lang="ts">
import type { PublicArticleCreditIdentity } from '~~/shared/types/article-credit-identities'
import {
  formatArticleCreditDate,
  resolveArticleCredits
} from '~~/shared/utils/article-credits'
import { resolveStaticMediaUrl } from '~~/shared/utils/static-media'

const props = defineProps<{
  authors?: unknown
  contributors?: unknown
  publishedAt?: unknown
  updatedAt?: unknown
  identities: PublicArticleCreditIdentity[]
}>()

const credits = computed(() => resolveArticleCredits(
  props.authors,
  props.contributors,
  props.identities
))
const publishedDate = computed(() => formatArticleCreditDate(props.publishedAt))
const updatedDate = computed(() => formatArticleCreditDate(props.updatedAt))
const hasCredits = computed(() => credits.value.authors.length || credits.value.collaborators.length)
</script>

<template>
  <div v-if="hasCredits || publishedDate || updatedDate" class="article-credits">
    <div v-if="credits.authors.length" class="article-credit-row">
      <span class="article-credit-label">作者</span>
      <div class="article-credit-people">
        <template
          v-for="credit in credits.authors"
          :key="credit.memberKey"
        >
          <NuxtLink v-if="credit.path" :to="credit.path" class="article-credit-person">
            <img :src="resolveStaticMediaUrl(credit.image || '/images/logo.png')" :alt="`${credit.name}的头像`" loading="lazy" decoding="async">
            <span>{{ credit.name }}</span>
          </NuxtLink>
          <span v-else class="article-credit-person">
            <img :src="resolveStaticMediaUrl(credit.image || '/images/logo.png')" :alt="`${credit.name}的头像`" loading="lazy" decoding="async">
            <span>{{ credit.name }}</span>
          </span>
        </template>
      </div>
    </div>
    <div v-if="credits.collaborators.length" class="article-credit-row">
      <span class="article-credit-label">协作者</span>
      <div class="article-credit-people">
        <template
          v-for="credit in credits.collaborators"
          :key="credit.memberKey"
        >
          <NuxtLink v-if="credit.path" :to="credit.path" class="article-credit-person">
            <img :src="resolveStaticMediaUrl(credit.image || '/images/logo.png')" :alt="`${credit.name}的头像`" loading="lazy" decoding="async">
            <span>{{ credit.name }}</span>
          </NuxtLink>
          <span v-else class="article-credit-person">
            <img :src="resolveStaticMediaUrl(credit.image || '/images/logo.png')" :alt="`${credit.name}的头像`" loading="lazy" decoding="async">
            <span>{{ credit.name }}</span>
          </span>
        </template>
      </div>
    </div>
    <div v-if="publishedDate || updatedDate" class="article-credit-dates">
      <span v-if="publishedDate">发布于 {{ publishedDate }}</span>
      <span v-if="updatedDate">更新于 {{ updatedDate }}</span>
    </div>
  </div>
</template>
