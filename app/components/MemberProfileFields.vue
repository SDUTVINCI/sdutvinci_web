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
const teamPositionOptions = ['队长', '副队长', '机电创新学会会长']
const isTeacher = computed({
  get: () => form.value.positions.includes('指导老师'),
  set: (selected: boolean) => {
    form.value.positions = form.value.positions.filter(position => position !== '指导老师')
    if (selected) {
      form.value.isLearner = false
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
const gradeRequired = computed(() => !isTeacher.value && !props.allowEmptyGrade)
const activeSeasons = computed(() => [...new Set<string>(props.options?.seasons || [])])
const seasonChoices = (selected: string[]) => [...new Set([...activeSeasons.value, ...selected])]
  .sort((left, right) => Number(left) - Number(right))
  .map(season => ({ season, historical: !activeSeasons.value.includes(season) }))
const participationSeasonChoices = computed(() => seasonChoices(form.value.seasons))
const advisorSeasonChoices = computed(() => seasonChoices(form.value.advisorSeasons))

watch(cohort, (value, previous) => {
  if (props.disabled || !previous || value?.gradeYear === previous.gradeYear) return
  if (form.value.groupName && !value?.groups.includes(form.value.groupName)) form.value.groupName = ''
})

watch(() => form.value.isLearner, value => {
  if (value) { form.value.positions = []; form.value.seasons = []; form.value.advisorSeasons = [] }
})

watch([isTeacher, () => form.value.advisorSeasons.join(',')], () => {
  if (form.value.isLearner) return
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
  form.value.teacherDetails = ''
  form.value.positions = form.value.positions.filter(position => position !== '顾问')
  if (form.value.advisorSeasons.length) form.value.positions.push('顾问')
}, { immediate: true })

const toggleGroupPosition = (position: string) => {
  if (props.disabled || form.value.isLearner || isTeacher.value) return
  groupPosition.value = groupPosition.value === position ? '' : position
}
</script>

<template>
  <fieldset class="member-choice-fieldset"><legend>特殊成员身份（可选，正式成员不要选）</legend><div class="member-choice-grid"><label class="member-choice"><input v-model="isTeacher" type="checkbox" :disabled="disabled || form.isLearner"><span>指导老师</span></label><label class="member-choice"><input v-model="form.isLearner" type="checkbox" :disabled="disabled || isTeacher"><span>新学员</span></label></div><p v-if="form.isLearner">新学员将在“智能机器人创新实践基地学员”中展示，暂不填写职务、参赛赛季和顾问届次。</p></fieldset>
<label v-if="isTeacher"><span>任职与职称补充信息（可选）</span><input v-model.trim="form.teacherDetails" :disabled="disabled" maxlength="200" placeholder="例如：机械电子工程系，教授，博导"><small>公开展示：指导老师{{ form.teacherDetails ? `，${form.teacherDetails}` : '' }}</small></label>
  <fieldset class="member-choice-fieldset" :disabled="disabled || form.isLearner || isTeacher"><legend>团队内的职务（可多选）</legend><div class="member-choice-grid"><label v-for="position in options?.teamPositions || teamPositionOptions" :key="position" class="member-choice"><input v-model="teamPositions" type="checkbox" :value="position" :disabled="disabled || form.isLearner || isTeacher"><span>{{ position }}</span></label></div></fieldset>
  <fieldset class="member-choice-fieldset" :disabled="disabled || form.isLearner || isTeacher"><legend>组内的职务（单选，可再次点击取消）</legend><div class="member-choice-grid"><button v-for="position in [{ value: '组长', label: '组长' }, { value: '成员', label: '组员' }]" :key="position.value" type="button" class="member-choice member-choice-button" :aria-pressed="groupPosition === position.value" :disabled="disabled || form.isLearner || isTeacher" @click="toggleGroupPosition(position.value)"><span class="member-choice-dot" aria-hidden="true" /><span>{{ position.label }}</span></button></div></fieldset>
  <div class="member-application-grid">
    <label><span>姓名 <strong v-if="required" class="member-required-marker">必填</strong></span><input v-model.trim="form.name" :disabled="disabled" maxlength="100" required placeholder="请输入真实姓名"></label>
    <label><span>年级 <strong v-if="gradeRequired" class="member-required-marker">必填</strong><span v-else-if="isTeacher">（指导老师不适用）</span></span><select v-model="form.grade" :disabled="disabled || isTeacher" :required="gradeRequired"><option value="">请选择</option><option v-for="item in gradeChoices" :key="item.id" :value="String(item.gradeYear)">{{ item.gradeYear }} 级</option></select></label>
    <label><span>组别（可选）</span><select v-model="form.groupName" :disabled="disabled || isTeacher"><option value="">{{ isTeacher ? '指导老师不适用' : '不属于具体组别' }}</option><option v-for="group in groupChoices" :key="group">{{ group }}</option></select></label>
    <label><span>学院 / 单位（可选）</span><select v-model="form.affiliation" :disabled="disabled"><option value="">请选择</option><option v-if="form.affiliation && !options?.colleges?.includes(form.affiliation)" :value="form.affiliation">{{ form.affiliation }}</option><option v-for="college in options?.colleges || []" :key="college">{{ college }}</option></select></label>
  </div>
  <fieldset class="member-choice-fieldset" :aria-required="required && !form.isLearner ? 'true' : undefined"><legend>参加过的赛季 <strong v-if="required && !form.isLearner" class="member-required-marker">必填</strong>（可多选）</legend><div class="member-choice-grid member-season-grid"><label v-for="item in participationSeasonChoices" :key="item.season" class="member-choice"><input v-model="form.seasons" type="checkbox" :value="item.season" :disabled="disabled || form.isLearner"><span>{{ item.season }} 赛季{{ item.historical ? '（历史届次）' : '' }}</span></label></div></fieldset>
  <fieldset class="member-choice-fieldset" :disabled="disabled || form.isLearner || isTeacher"><legend>顾问届次（可选、多选）</legend><div class="member-choice-grid member-season-grid"><label v-for="item in advisorSeasonChoices" :key="item.season" class="member-choice"><input v-model="form.advisorSeasons" type="checkbox" :value="item.season" :disabled="disabled || form.isLearner || isTeacher"><span>{{ item.season }} 赛季{{ item.historical ? '（历史届次）' : '' }}</span></label></div></fieldset>
  <label><span>简介（可选）</span><textarea v-model="form.body" :disabled="disabled" rows="7" maxlength="10000" placeholder="介绍职责、方向或主要经历" /></label>
  <div class="member-application-grid">
    <label><span>GitHub 链接（可选）</span><input v-model.trim="form.links.github" :disabled="disabled" type="url" maxlength="2048" placeholder="https://github.com/..."></label>
    <label><span>个人主页链接（可选）</span><input v-model.trim="form.links['home-page']" :disabled="disabled" type="url" maxlength="2048" placeholder="https://..."></label>
  </div>
</template>
