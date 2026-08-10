<script setup lang="ts">
definePageMeta({ layout: 'cms', middleware: ['cms-auth', 'cms-admin'] })
const { csrfHeaders } = useCmsSession()
const { data, refresh } = await useFetch<any>('/api/cms/member-options')
const message = ref('')
const errorMessage = ref('')
const showAdd = ref(false)
const savingId = ref('')
const drafts = reactive<Record<string, { gradeYear: number, season: string, groups: string, active: boolean }>>({})
const newDraft = reactive({ gradeYear: new Date().getFullYear(), season: '', groups: '', active: true })

const syncDrafts = () => {
  for (const cohort of data.value?.cohorts || []) drafts[cohort.id] = {
    gradeYear: cohort.gradeYear, season: cohort.season, groups: cohort.groups.join('，'), active: cohort.active
  }
}
const draftFor = (cohort: any) => drafts[cohort.id] ||= {
  gradeYear: cohort.gradeYear, season: cohort.season, groups: cohort.groups.join('，'), active: cohort.active
}
watch(data, syncDrafts, { immediate: true })

const save = async (draft: typeof newDraft, id = 'new') => {
  message.value = ''; errorMessage.value = ''; savingId.value = id
  try {
    await $fetch('/api/cms/member-options', { method: 'POST', headers: csrfHeaders(), body: {
      gradeYear: draft.gradeYear, season: draft.season, active: draft.active,
      groups: draft.groups.split(/[,，]/).map(value => value.trim()).filter(Boolean)
    } })
    message.value = id === 'new' ? `已添加 ${draft.gradeYear} 级` : `已保存 ${draft.gradeYear} 级`
    if (id === 'new') {
      Object.assign(newDraft, { gradeYear: Math.max(...(data.value?.cohorts || []).map((item: any) => item.gradeYear), new Date().getFullYear()) + 1, season: '', groups: '', active: true })
      showAdd.value = false
    }
    await refresh()
  } catch (error: any) { errorMessage.value = error?.data?.message || '保存失败' }
  finally { savingId.value = '' }
}
</script>

<template>
  <section class="cms-page member-options-page">
    <header class="cms-page-header cms-page-header-actions">
      <div><p class="cms-eyebrow">MEMBER OPTIONS</p><h1>成员年度选项</h1><p>每一届单独维护赛季和组别；修改后在当前卡片直接保存。</p></div>
      <button class="cms-button cms-button-primary" type="button" @click="showAdd = !showAdd">{{ showAdd ? '取消添加' : '添加新一届' }}</button>
    </header>
    <p v-if="message" class="cms-alert">{{ message }}</p><p v-if="errorMessage" class="cms-alert cms-alert-error">{{ errorMessage }}</p>

    <form v-if="showAdd" class="cms-panel member-option-card member-option-new" @submit.prevent="save(newDraft)">
      <div class="member-option-card-heading"><div><p class="cms-eyebrow">NEW COHORT</p><h2>添加新一届</h2></div><span class="cms-badge">新配置</span></div>
      <div class="member-option-fields"><label><span>年级</span><input v-model.number="newDraft.gradeYear" type="number" min="2000" max="2200" required></label><label><span>赛季</span><input v-model.trim="newDraft.season" maxlength="16" placeholder="例如 28" required></label></div>
      <label><span>可选组别</span><input v-model="newDraft.groups" required placeholder="机械组，嵌入式组，软件算法组，运营组"><small>使用中文或英文逗号分隔</small></label>
      <footer class="member-option-card-actions"><label class="member-option-toggle"><input v-model="newDraft.active" type="checkbox"><span>立即启用</span></label><button class="cms-button cms-button-primary" :disabled="savingId === 'new'">{{ savingId === 'new' ? '正在添加…' : '添加这一届' }}</button></footer>
    </form>

    <div class="member-option-summary"><div><strong>{{ data?.cohorts.length || 0 }}</strong><span>已配置届次</span></div><div><strong>{{ data?.cohorts.filter((item: any) => item.active).length || 0 }}</strong><span>当前启用</span></div><p>年级是稳定基准，停用后该届不会出现在公开申请表单中。</p></div>

    <section class="member-option-list" aria-label="现有年度">
      <form v-for="cohort in data?.cohorts || []" :key="cohort.id" class="cms-panel member-option-card" @submit.prevent="save(draftFor(cohort), cohort.id)">
        <div class="member-option-card-heading"><div><p class="cms-eyebrow">{{ cohort.season }} SEASON</p><h2>{{ cohort.gradeYear }} 级</h2></div><span class="cms-badge" :class="{ 'cms-badge-muted': !draftFor(cohort).active }">{{ draftFor(cohort).active ? '已启用' : '已停用' }}</span></div>
        <div class="member-option-fields"><label><span>年级</span><input v-model.number="draftFor(cohort).gradeYear" type="number" min="2000" max="2200" required disabled></label><label><span>赛季</span><input v-model.trim="draftFor(cohort).season" maxlength="16" required></label></div>
        <label><span>可选组别</span><input v-model="draftFor(cohort).groups" required><small>使用中文或英文逗号分隔</small></label>
        <footer class="member-option-card-actions"><label class="member-option-toggle"><input v-model="draftFor(cohort).active" type="checkbox"><span>在表单中启用</span></label><button class="cms-button cms-button-primary" :disabled="savingId === cohort.id">{{ savingId === cohort.id ? '正在保存…' : '保存这一届' }}</button></footer>
      </form>
    </section>
  </section>
</template>
