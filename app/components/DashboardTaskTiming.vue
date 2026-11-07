<script setup lang="ts">
import { dashboardUnclaimed, type DashboardTask } from '~/utils/dashboard'
import { dashboardTaskCountdown, dashboardUrgency } from '../../utils/dashboard-experience.mjs'
const props = defineProps<{ task: DashboardTask; now: number }>()
const dateFormat = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
})
const deadline = computed(() => props.task.deadline ? dateFormat.format(props.task.deadline) : '')
const deadlineIso = computed(() => props.task.deadline ? new Date(props.task.deadline).toISOString() : undefined)
const completed = computed(() => props.task.completedAt ? `审核通过 ${dateFormat.format(props.task.completedAt)}` : '审核时间未记录')
const remaining = computed(() => dashboardTaskCountdown(props.task, props.now))
const urgency = computed(() => dashboardUrgency(props.task, props.now)?.level)
</script>

<template>
  <div class="dashboard-task-timing" :class="[task.status === 'done' && !dashboardUnclaimed(task) ? 'done' : urgency]">
    <span class="dashboard-task-remaining">{{ task.status === 'done' && !dashboardUnclaimed(task) ? completed : remaining }}</span>
    <time v-if="deadline && !dashboardUnclaimed(task)" :datetime="deadlineIso" class="dashboard-task-deadline">截止 {{ deadline }}</time>
    <span v-else-if="task.status === 'done' && !dashboardUnclaimed(task)" class="dashboard-task-deadline">未设置截止</span>
  </div>
</template>
