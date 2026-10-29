<script setup lang="ts">
import type { DashboardTask } from '~/utils/dashboard'
import { dashboardTaskState, dashboardTaskGroups, dashboardScoreLabel } from '~/utils/dashboard'
import { dashboardUrgency } from '../../utils/dashboard-experience.mjs'
const props = defineProps<{
  task: DashboardTask; now: number
  profileFor: (name: string) => { href: string; image: string }
}>()
const emit = defineEmits<{ close: [] }>()
const state = computed(() => dashboardTaskState(props.task, props.now))
const urgency = computed(() => dashboardUrgency(props.task, props.now))
const format = (value: number | null) => value ? new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
}).format(value) : '未记录'
</script>

<template>
  <DashboardDialog :open="true" labelledby="dashboard-task-detail-title" @close="emit('close')">
    <header class="dashboard-dialog-heading"><p class="eyebrow">Task Details / 任务详情</p><button type="button" autofocus aria-label="关闭任务详情" @click="emit('close')">关闭 ×</button></header>
    <h2 id="dashboard-task-detail-title">{{ task.title }}</h2>
    <div class="dashboard-detail-tags">
      <span class="dashboard-detail-state">{{ state === 'done' ? '已完成' : state === 'overdue' ? '已逾期' : '未完成' }}</span>
      <span v-if="task.statusMissing" class="dashboard-warning">状态未填写，暂按未完成</span>
      <span class="dashboard-score" :class="{ 'is-invalid': task.scoreInvalid }">{{ dashboardScoreLabel(task) }}</span>
      <span v-if="urgency && state !== 'overdue'" class="dashboard-urgency" :class="urgency.level">{{ urgency.label }}</span>
    </div>
    <dl class="dashboard-detail-fields">
      <div><dt>执行人</dt><dd class="dashboard-detail-people"><DashboardMember v-for="person in task.assignees" :key="person.key" :person="person" :profile="profileFor(person.name)" /><span v-if="!task.assignees.length">待分配</span></dd></div>
      <div><dt>发布人</dt><dd class="dashboard-detail-people"><DashboardMember v-for="person in task.publishers || []" :key="person.key" :person="person" :profile="profileFor(person.name)" /><span v-if="!task.publishers?.length">{{ task.publisher || '未记录' }}</span></dd></div>
      <div><dt>组别</dt><dd class="dashboard-detail-tags"><span v-for="group in dashboardTaskGroups(task)" :key="group">{{ group }}</span><span v-if="!dashboardTaskGroups(task).length">未分组</span></dd></div>
      <div><dt>截止时间</dt><dd><time v-if="task.deadline !== null" :datetime="new Date(task.deadline).toISOString()">{{ format(task.deadline) }} · 北京时间</time><span v-else>未设置</span></dd></div>
      <div v-if="task.status === 'done'"><dt>完成时间</dt><dd><time v-if="task.completedAt !== null" :datetime="new Date(task.completedAt).toISOString()">{{ format(task.completedAt) }} · 北京时间</time><span v-else>未记录</span></dd></div>
    </dl>
    <section class="dashboard-detail-note"><h3>备注</h3><p>{{ task.note || '暂无备注' }}</p></section>
  </DashboardDialog>
</template>
