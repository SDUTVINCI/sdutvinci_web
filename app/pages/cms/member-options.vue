<script setup lang="ts">
definePageMeta({ middleware: ['cms-auth', 'cms-admin'] })
const { csrfHeaders } = useCmsSession()
const { data, refresh } = await useFetch<any>('/api/cms/member-options')
const message = ref('')
const errorMessage = ref('')
const draft = reactive({ gradeYear: new Date().getFullYear(), season: '', groups: '' })

const edit = (cohort: any) => Object.assign(draft, {
  gradeYear: cohort.gradeYear,
  season: cohort.season,
  groups: cohort.groups.join('，')
})
const save = async () => {
  message.value = ''; errorMessage.value = ''
  try {
    await $fetch('/api/cms/member-options', { method: 'POST', headers: csrfHeaders(), body: {
      gradeYear: draft.gradeYear, season: draft.season,
      groups: draft.groups.split(/[,，]/).map(value => value.trim()).filter(Boolean)
    } })
    message.value = '年度选项已保存'; await refresh()
  } catch (error: any) { errorMessage.value = error?.data?.message || '保存失败' }
}
</script>

<template>
  <section class="cms-page">
    <header class="cms-page-header"><div><p class="cms-eyebrow">MEMBER OPTIONS</p><h1>成员年度选项</h1><p>年级是稳定基准；每个年级配置赛季和可选组别。填写新年级即可添加新一届。</p></div></header>
    <p v-if="message" class="cms-alert">{{ message }}</p><p v-if="errorMessage" class="cms-alert cms-alert-error">{{ errorMessage }}</p>
    <form class="cms-panel cms-form" @submit.prevent="save">
      <label><span>年级</span><input v-model.number="draft.gradeYear" type="number" min="2000" max="2200" required></label>
      <label><span>赛季</span><input v-model.trim="draft.season" maxlength="16" placeholder="例如 25" required></label>
      <label><span>可选组别（逗号分隔）</span><input v-model="draft.groups" required></label>
      <button class="cms-button cms-button-primary">保存 / 添加这一届</button>
    </form>
    <section class="cms-panel"><h2>现有年度</h2><table><thead><tr><th>年级</th><th>赛季</th><th>组别</th><th /></tr></thead><tbody><tr v-for="cohort in data?.cohorts" :key="cohort.id"><td>{{ cohort.gradeYear }}</td><td>{{ cohort.season }}</td><td>{{ cohort.groups.join('、') }}</td><td><button class="cms-button" @click="edit(cohort)">修改</button></td></tr></tbody></table></section>
  </section>
</template>
