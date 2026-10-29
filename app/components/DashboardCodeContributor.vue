<script setup lang="ts">
import type { DashboardDevelopment } from '~/utils/dashboard'
defineProps<{ person: DashboardDevelopment['contributors'][number]; profile: { name: string; href: string; image: string; external: boolean } }>()
</script>

<template>
  <DashboardCodeIdentity :profile="profile" class="dashboard-code-person">
    <strong :aria-label="`${person.count} 次提交`">{{ person.count }}</strong>
  </DashboardCodeIdentity>
</template>
