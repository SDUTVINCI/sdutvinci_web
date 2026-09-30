<script setup lang="ts">
import type { MemberProfileFormModel } from '../../shared/types/member-profile-form'

const props = withDefaults(defineProps<{ options: any, disabled?: boolean, required?: boolean }>(), {
  disabled: false,
  required: false
})
const form = defineModel<MemberProfileFormModel>({ required: true })
const cohort = computed(() => props.options?.cohorts.find((item: any) => String(item.gradeYear) === form.value.grade))
const teamPositionOptions = ['队长', '副队长', '机电创新学会会长']
const isTeacher = computed({
  get: () => form.value.positions.includes('指导老师'),
  set: (selected: boolean) => {
    form.value.positions = form.value.positions.filter(position => position !== '指导老师')
    if (selected) {
      form.value.seasons = [...new Set([...form.value.seasons, ...form.value.advisorSeasons])]
      form.value.positions = ['指导老师']
      form.value.grade = ''
      form.value.groupName = ''
      form.value.advisorSeasons = []
    }
  }
})
const teamPositions = computed({
  get: () => form.value.positions.filter(position => teamPositionOptions.includes(position)),
  set: (selected: string[]) => {
    form.value.positions = [...form.value.positions.filter(position => !teamPositionOptions.includes(position)), ...selected]
  }
})
const groupPosition = computed({
  get: () => form.value.positions.includes('组长') ? '组长' : form.value.positions.includes('成员') ? '成员' : '',
  set: (selected: string) => {
    form.value.positions = form.value.positions.filter(position => !['组长', '成员'].includes(position))
    if (selected) form.value.positions.push(selected)
  }
})
const gradeRequired = computed(() => !isTeacher.value)
const activeSeasons = computed(() => [...new Set<string>((props.options?.cohorts || []).map((item: any) => String(item.season)))])
const seasonChoices = (selected: string[]) => [...new Set([...activeSeasons.value, ...selected])]
  .sort((left, right) => Number(left) - Number(right))
  .map(season => ({ season, historical: !activeSeasons.value.includes(season) }))
const participationSeasonChoices = computed(() => seasonChoices(form.value.seasons))
const advisorSeasonChoices = computed(() => seasonChoices(form.value.advisorSeasons))

watch(cohort, (value) => {
  if (props.disabled) return
  if (value && !isTeacher.value && !form.value.seasons.length) form.value.seasons = [value.season]
  if (form.value.groupName && !value?.groups.includes(form.value.groupName)) form.value.groupName = ''
})

watch([isTeacher, () => form.value.advisorSeasons.join(',')], () => {
  if (isTeacher.value) {
    // Show historical teacher seasons in the field that now represents participation.
    if (form.value.advisorSeasons.length) {
      form.value.seasons = [...new Set([...form.value.seasons, ...form.value.advisorSeasons])]
    }
    form.value.advisorSeasons = []
    form.value.positions = ['指导老师']
    form.value.grade = ''
    form.value.groupName = ''
    return
  }
  form.value.positions = form.value.positions.filter(position => position !== '顾问')
  if (form.value.advisorSeasons.length) form.value.positions.push('顾问')
}, { immediate: true })

const toggleGroupPosition = (position: string) => {
  if (props.disabled || isTeacher.value) return
  groupPosition.value = groupPosition.value === position ? '' : position
}
</script>

<template>
  <fieldset class="member-choice-fieldset"><legend>是否为指导老师</legend><div class="member-choice-grid"><label class="member-choice"><input v-model="isTeacher" type="checkbox" :disabled="disabled"><span>指导老师</span></label></div></fieldset>
  <fieldset class="member-choice-fieldset" :disabled="disabled || isTeacher"><legend>团队内的职务（可多选）</legend><div class="member-choice-grid"><label v-for="position in options?.teamPositions || teamPositionOptions" :key="position" class="member-choice"><input v-model="teamPositions" type="checkbox" :value="position" :disabled="disabled || isTeacher"><span>{{ position }}</span></label></div></fieldset>
  <fieldset class="member-choice-fieldset" :disabled="disabled || isTeacher"><legend>组内的职务（单选，可再次点击取消）</legend><div class="member-choice-grid"><button v-for="position in [{ value: '组长', label: '组长' }, { value: '成员', label: '组员' }]" :key="position.value" type="button" class="member-choice member-choice-button" :aria-pressed="groupPosition === position.value" :disabled="disabled || isTeacher" @click="toggleGroupPosition(position.value)"><span class="member-choice-dot" aria-hidden="true" /><span>{{ position.label }}</span></button></div></fieldset>
  <div class="member-application-grid">
    <label><span>姓名 <strong v-if="required" class="member-required-marker">必填</strong></span><input v-model.trim="form.name" :disabled="disabled" maxlength="100" required placeholder="请输入真实姓名"></label>
    <label><span>年级 <strong v-if="gradeRequired" class="member-required-marker">必填</strong><span v-else>（指导老师不适用）</span></span><select v-model="form.grade" :disabled="disabled || isTeacher" :required="gradeRequired"><option value="">请选择</option><option v-for="item in options?.cohorts" :key="item.id" :value="String(item.gradeYear)">{{ item.gradeYear }} 级</option></select></label>
    <label><span>组别（可选）</span><select v-model="form.groupName" :disabled="disabled || isTeacher || !cohort"><option value="">{{ isTeacher ? '指导老师不适用' : '不属于具体组别' }}</option><option v-for="group in cohort?.groups || []" :key="group">{{ group }}</option></select></label>
    <label><span>学院 / 单位（可选）</span><select v-model="form.affiliation" :disabled="disabled"><option value="">请选择</option><option v-for="college in options?.colleges || []" :key="college">{{ college }}</option></select></label>
  </div>
  <fieldset class="member-choice-fieldset" aria-required="true"><legend>参加过的赛季 <strong class="member-required-marker">必填</strong>（可多选）</legend><div class="member-choice-grid member-season-grid"><label v-for="item in participationSeasonChoices" :key="item.season" class="member-choice"><input v-model="form.seasons" type="checkbox" :value="item.season" :disabled="disabled"><span>{{ item.season }} 赛季{{ item.historical ? '（历史届次）' : '' }}</span></label></div></fieldset>
  <fieldset class="member-choice-fieldset" :disabled="disabled || isTeacher"><legend>顾问届次（可选、多选）</legend><div class="member-choice-grid member-season-grid"><label v-for="item in advisorSeasonChoices" :key="item.season" class="member-choice"><input v-model="form.advisorSeasons" type="checkbox" :value="item.season" :disabled="disabled || isTeacher"><span>{{ item.season }} 赛季{{ item.historical ? '（历史届次）' : '' }}</span></label></div></fieldset>
  <label><span>简介（可选）</span><textarea v-model="form.body" :disabled="disabled" rows="7" maxlength="10000" placeholder="介绍职责、方向或主要经历" /></label>
  <div class="member-application-grid">
    <label><span>GitHub 链接（可选）</span><input v-model.trim="form.links.github" :disabled="disabled" type="url" maxlength="2048" placeholder="https://github.com/..."></label>
    <label><span>个人主页链接（可选）</span><input v-model.trim="form.links['home-page']" :disabled="disabled" type="url" maxlength="2048" placeholder="https://..."></label>
  </div>
</template>
