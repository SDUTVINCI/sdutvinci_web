<script setup lang="ts">
import type { DashboardTask } from '~/utils/dashboard'
import { dashboardTaskCountdown, dashboardUrgency } from '../../utils/dashboard-experience.mjs'
const props = defineProps<{ task: DashboardTask; now: number }>()
const dateFormat = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
})
const deadline = computed(() => props.task.deadline ? dateFormat.format(props.task.deadline) : '')
const deadlineIso = computed(() => props.task.deadline ? new Date(props.task.deadline).toISOString() : undefined)
const completed = computed(() => props.task.completedAt ? `完成于 ${dateFormat.format(props.task.completedAt)}` : '完成时间未记录')
const remaining = computed(() => dashboardTaskCountdown(props.task, props.now))
const urgency = computed(() => dashboardUrgency(props.task, props.now)?.level)
</script>

<template>
  <div class="dashboard-task-timing" :class="[task.status === 'done' ? 'done' : urgency]">
    <span class="dashboard-task-remaining">{{ task.status === 'done' ? completed : remaining }}</span>
    <time v-if="deadline" :datetime="deadlineIso" class="dashboard-task-deadline">截止 {{ deadline }}</time>
    <span v-else-if="task.status === 'done'" class="dashboard-task-deadline">未设置截止</span>
  </div>
</template>
