<script setup lang="ts">
import { dashboardScoreLabel, type DashboardTask } from '~/utils/dashboard'
import { dashboardUrgency } from '../../utils/dashboard-experience.mjs'
const props = defineProps<{ task: DashboardTask; currentTime: number; paginated: boolean; profileFor: (name: string) => { href: string; image: string } }>()
const emit = defineEmits<{ open: [id: string] }>()
const publishers = computed(() => props.task.publishers || [{ key: props.task.publisher, name: props.task.publisher, avatar: '' }])
</script>

<template>
  <div class="dashboard-task-top"><span v-if="task.group" class="dashboard-tag" :title="task.group">{{ task.group }}</span><div class="dashboard-task-flags"><span v-if="task.statusMissing" class="dashboard-status-missing dashboard-warning" title="暂按未完成展示，完成后才计分">状态未填写</span><span v-if="dashboardUrgency(task, currentTime)" class="dashboard-urgency" :class="dashboardUrgency(task, currentTime)!.level">{{ dashboardUrgency(task, currentTime)!.label }}</span><span class="dashboard-score" :class="{ 'is-invalid': task.scoreInvalid }">{{ dashboardScoreLabel(task) }}</span></div></div>
  <h3><button type="button" class="dashboard-task-title" :aria-label="`查看任务详情：${task.title}`" @click="emit('open', task.id)">{{ task.title }}</button></h3>
  <div class="dashboard-assignees"><span class="dashboard-label">执行人</span><span v-if="!task.assignees.length">待分配</span><DashboardMember v-for="person in paginated ? task.assignees.slice(0, 2) : task.assignees" :key="person.key" :person="person" :profile="profileFor(person.name)" /><button v-if="paginated && task.assignees.length > 2" type="button" class="dashboard-more-people" :aria-label="`另有${task.assignees.length - 2}位执行人，查看全部`" @click="emit('open', task.id)">+{{ task.assignees.length - 2 }}</button></div>
  <p v-if="task.note" class="dashboard-note" :title="task.note">{{ task.note }}</p>
  <div class="dashboard-task-meta" :class="{ 'has-publisher': task.publisher }"><DashboardTaskTiming :task="task" :now="currentTime" /><span v-if="task.publisher" class="dashboard-publishers"><span class="dashboard-publisher-label">发布人</span> <DashboardMember v-for="person in paginated ? publishers.slice(0, 1) : publishers" :key="person.key" :person="person" :profile="profileFor(person.name)" /><button v-if="paginated && publishers.length > 1" type="button" class="dashboard-more-people" :aria-label="`另有${publishers.length - 1}位发布人，查看全部`" @click="emit('open', task.id)">+{{ publishers.length - 1 }}</button></span></div>
</template>
