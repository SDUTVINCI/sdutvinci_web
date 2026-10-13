<script setup lang="ts">
import type { MemberProfileFormModel } from '../../shared/types/member-profile-form'

const props = withDefaults(defineProps<{ options: any, disabled?: boolean, required?: boolean, allowEmptyGrade?: boolean }>(), { disabled: false, required: false, allowEmptyGrade: false })
const form = defineModel<MemberProfileFormModel>({ required: true })
const cohort = computed(() => props.options?.cohorts.find((item: any) => String(item.gradeYear) === form.value.grade))
const gradeChoices = computed(() => {
  const choices = props.options?.cohorts || []
  return form.value.grade && !choices.some((item: any) => String(item.gradeYear) === form.value.grade)
    ? [...choices, { id: 'historical', gradeYear: form.value.grade }] : choices
})
const groupChoices = computed(() => [...new Set<string>([...(cohort.value?.groups || []), ...(form.value.groupName ? [form.value.groupName] : [])])])
const seasonChoices = computed(() => [...new Set<string>([...(props.options?.seasons || []), ...form.value.seasons, ...form.value.advisorSeasons])])
const teacher = computed({
  get: () => form.value.positions.includes('指导老师'),
  set: (value: boolean) => {
    if (value) { form.value.isLearner = false; form.value.positions = ['指导老师'] }
    else form.value.positions = form.value.positions.filter(item => item !== '指导老师')
  }
})
const groupPosition = computed(() => form.value.positions.find(item => ['组长', '成员'].includes(item)))
const toggleGroupPosition = (position: string) => {
  if (props.disabled || form.value.isLearner || teacher.value) return
  const selected = groupPosition.value
  form.value.positions = form.value.positions.filter(item => !['组长', '成员'].includes(item))
  if (selected !== position) form.value.positions.push(position)
}
watch(() => form.value.isLearner, (value) => {
  if (value) { form.value.positions = []; form.value.seasons = []; form.value.advisorSeasons = [] }
})
watch(cohort, (value, previous) => {
  if (props.disabled || !previous || value?.gradeYear === previous.gradeYear) return
  if (form.value.groupName && !value?.groups.includes(form.value.groupName)) form.value.groupName = ''
})
</script>

<template>
  <fieldset class="member-choice-fieldset"><legend>特殊成员身份（可选，正式成员不要选）</legend><div class="member-choice-grid">
    <label class="member-choice"><input v-model="teacher" type="checkbox" :disabled="disabled || form.isLearner"><span>指导老师</span></label>
    <label class="member-choice"><input v-model="form.isLearner" type="checkbox" :disabled="disabled || teacher"><span>新学员</span></label>
  </div><p v-if="form.isLearner">新学员将在“智能机器人创新实践基地学员”中展示，暂不填写职务、参赛赛季和顾问届次。</p></fieldset>
  <fieldset class="member-choice-fieldset"><legend>团队内的职务（可多选）</legend><div class="member-choice-grid"><label v-for="position in ['队长', '副队长', '机电创新学会会长']" :key="position" class="member-choice"><input v-model="form.positions" type="checkbox" :value="position" :disabled="disabled || form.isLearner || teacher"><span>{{ position }}</span></label></div></fieldset>
  <fieldset class="member-choice-fieldset"><legend>组内的职务（单选，可再次点击取消）</legend><div class="member-choice-grid"><label v-for="position in ['组长', '成员']" :key="position" class="member-choice"><input type="radio" :checked="groupPosition === position" :disabled="disabled || form.isLearner || teacher" @click="toggleGroupPosition(position)"><span>{{ position === '成员' ? '组员' : position }}</span></label></div></fieldset>
  <div class="member-application-grid">
    <label><span>姓名 <strong v-if="required" class="member-required-marker">必填</strong></span><input v-model.trim="form.name" :disabled="disabled" maxlength="100" required placeholder="请输入真实姓名"></label>
    <label><span>年级 <strong v-if="required && !allowEmptyGrade" class="member-required-marker">必填</strong></span><select v-model="form.grade" :disabled="disabled" :required="!allowEmptyGrade"><option value="">请选择</option><option v-for="item in gradeChoices" :key="item.id" :value="String(item.gradeYear)">{{ item.gradeYear }} 级</option></select></label>
    <label><span>组别（可选）</span><select v-model="form.groupName" :disabled="disabled"><option value="">不属于具体组别</option><option v-for="group in groupChoices" :key="group">{{ group }}</option></select></label>
    <label><span>学院 / 单位（可选）</span><select v-model="form.affiliation" :disabled="disabled"><option value="">请选择</option><option v-if="form.affiliation && !options?.colleges?.includes(form.affiliation)" :value="form.affiliation">{{ form.affiliation }}</option><option v-for="college in options?.colleges" :key="college">{{ college }}</option></select></label>
  </div>
  <fieldset class="member-choice-fieldset" :aria-required="required && !form.isLearner && !teacher ? 'true' : undefined"><legend>参加过的赛季 <strong v-if="required && !form.isLearner && !teacher" class="member-required-marker">必填</strong>（可多选）</legend><div class="member-choice-grid member-season-grid"><label v-for="season in seasonChoices" :key="season" class="member-choice"><input v-model="form.seasons" type="checkbox" :value="season" :disabled="disabled || form.isLearner"><span>{{ season }} 赛季</span></label></div></fieldset>
  <fieldset class="member-choice-fieldset"><legend>顾问届次（可选、多选）</legend><div class="member-choice-grid member-season-grid"><label v-for="season in seasonChoices" :key="season" class="member-choice"><input v-model="form.advisorSeasons" type="checkbox" :value="season" :disabled="disabled || form.isLearner"><span>{{ season }} 赛季</span></label></div></fieldset>
  <label><span>简介（可选）</span><textarea v-model="form.body" :disabled="disabled" rows="7" maxlength="10000" placeholder="介绍方向或主要经历" /></label>
  <div class="member-application-grid">
    <label><span>GitHub 链接（可选）</span><input v-model.trim="form.links.github" :disabled="disabled" type="url" maxlength="2048" placeholder="https://github.com/..."></label>
    <label><span>个人主页链接（可选）</span><input v-model.trim="form.links['home-page']" :disabled="disabled" type="url" maxlength="2048" placeholder="https://..."></label>
  </div>
</template>
