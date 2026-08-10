<script setup lang="ts">
import type { MemberProfileFormModel } from '../../shared/types/member-profile-form'

const props = withDefaults(defineProps<{ options: any, disabled?: boolean }>(), { disabled: false })
const form = defineModel<MemberProfileFormModel>({ required: true })
const cohort = computed(() => props.options?.cohorts.find((item: any) => String(item.gradeYear) === form.value.grade))

watch(cohort, (value) => {
  if (props.disabled) return
  if (value && !form.value.seasons.length) form.value.seasons = [value.season]
  if (form.value.groupName && !value?.groups.includes(form.value.groupName)) form.value.groupName = ''
})
</script>

<template>
  <div class="member-application-grid">
    <label><span>姓名</span><input v-model.trim="form.name" :disabled="disabled" maxlength="100" required placeholder="请输入真实姓名"></label>
    <label><span>年级</span><select v-model="form.grade" :disabled="disabled" required><option value="">请选择</option><option v-for="item in options?.cohorts" :key="item.id" :value="String(item.gradeYear)">{{ item.gradeYear }} 级</option></select></label>
    <label><span>组别</span><select v-model="form.groupName" :disabled="disabled"><option value="">不属于具体组别</option><option v-for="group in cohort?.groups || []" :key="group">{{ group }}</option></select></label>
    <label><span>学院 / 单位</span><select v-model="form.affiliation" :disabled="disabled"><option value="">请选择（可选）</option><option v-for="college in options?.colleges || []" :key="college">{{ college }}</option></select></label>
  </div>
  <fieldset class="member-choice-fieldset"><legend>职责（可多选）</legend><div class="member-choice-grid"><label v-for="position in options?.positions" :key="position" class="member-choice"><input v-model="form.positions" type="checkbox" :value="position" :disabled="disabled"><span>{{ position }}</span></label></div></fieldset>
  <fieldset class="member-choice-fieldset"><legend>参加过的赛季（可多选）</legend><div class="member-choice-grid member-season-grid"><label v-for="item in options?.cohorts" :key="item.id" class="member-choice"><input v-model="form.seasons" type="checkbox" :value="item.season" :disabled="disabled"><span>{{ item.season }} 赛季</span></label></div></fieldset>
  <fieldset class="member-choice-fieldset"><legend>顾问 / 指导届次（可选、多选）</legend><p class="member-choice-help">仅顾问或指导老师需要选择所指导的届次。</p><div class="member-choice-grid member-season-grid"><label v-for="item in options?.cohorts" :key="item.id" class="member-choice"><input v-model="form.advisorSeasons" type="checkbox" :value="item.season" :disabled="disabled"><span>{{ item.season }} 赛季</span></label></div></fieldset>
  <label><span>简介</span><textarea v-model="form.body" :disabled="disabled" rows="7" maxlength="10000" placeholder="介绍职责、方向或主要经历" /></label>
  <div class="member-application-grid">
    <label><span>GitHub 链接（可选）</span><input v-model.trim="form.links.github" :disabled="disabled" type="url" maxlength="2048" placeholder="https://github.com/..."></label>
    <label><span>个人主页链接（可选）</span><input v-model.trim="form.links.homepage" :disabled="disabled" type="url" maxlength="2048" placeholder="https://..."></label>
  </div>
</template>
