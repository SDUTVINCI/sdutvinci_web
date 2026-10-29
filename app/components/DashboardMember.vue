<script setup lang="ts">
import { NuxtLink } from '#components'
import { dashboardBrand as site } from '~/data/dashboard'
import type { DashboardPerson } from '~/utils/dashboard'
const props = defineProps<{ person: DashboardPerson; profile: { href: string; image: string } }>()
const failedAvatar = ref('')
const avatar = computed(() => props.profile.image && failedAvatar.value !== props.profile.image ? props.profile.image : site.logo)
</script>

<template>
  <component :is="profile.href ? NuxtLink : 'span'" class="dashboard-person" :to="profile.href || undefined" :title="profile.href ? `查看${person.name}的成员介绍` : undefined">
    <img :src="avatar" alt="" loading="lazy" referrerpolicy="no-referrer" @error="failedAvatar = avatar">
    <span>{{ person.name }}</span>
  </component>
</template>
