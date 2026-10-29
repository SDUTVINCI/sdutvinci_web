<script setup lang="ts">
import { NuxtLink } from '#components'
import { dashboardBrand as site } from '~/data/dashboard'
const props = defineProps<{ profile: { name: string; href: string; image: string; external: boolean } }>()
const failedAvatar = ref('')
const avatar = computed(() => props.profile.image && failedAvatar.value !== props.profile.image ? props.profile.image : site.logo)
</script>

<template>
  <component :is="profile.external ? 'a' : NuxtLink" class="dashboard-code-identity"
    :to="profile.external ? undefined : profile.href" :href="profile.external ? profile.href : undefined"
    :target="profile.external ? '_blank' : undefined" :rel="profile.external ? 'noopener noreferrer' : undefined"
    :title="profile.external ? `在 GitHub 查看${profile.name}的相关资料` : `查看${profile.name}的成员介绍`">
    <img :src="avatar" alt="" loading="lazy" referrerpolicy="no-referrer" @error="failedAvatar = avatar">
    <span class="dashboard-code-person-name">{{ profile.name }}</span>
    <slot />
  </component>
</template>
