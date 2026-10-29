<script setup lang="ts">
import type { DashboardTask } from '~/utils/dashboard'
import { dashboardCompletionStats } from '../../utils/dashboard-experience.mjs'
const props = defineProps<{ tasks: DashboardTask[]; now: number; scope: string }>()
const emit = defineEmits<{ close: [] }>()
const stats = computed(() => dashboardCompletionStats(props.tasks, props.now))
const peak = computed(() => Math.max(1, ...stats.value.days.map(day => day.count)))
</script>

<template>
  <DashboardDialog :open="true" labelledby="dashboard-completion-title" @close="emit('close')">
    <header class="dashboard-dialog-heading"><p class="eyebrow">Team Progress / 完成趋势</p><button type="button" autofocus aria-label="关闭完成趋势" @click="emit('close')">关闭 ×</button></header>
    <h2 id="dashboard-completion-title">近期完成趋势</h2>
    <p class="dashboard-completion-scope">{{ scope }} · 北京时间</p>
    <template v-if="stats.available">
      <dl class="dashboard-completion-metrics">
        <div><dt>本周完成</dt><dd>{{ stats.weekCount }}<small> 项</small></dd></div>
        <div><dt>近7天完成</dt><dd>{{ stats.recentCount }}<small> 项</small></dd></div>
        <div><dt>本周按时完成率</dt><dd>{{ stats.onTimeRate === null ? '—' : `${stats.onTimeRate}%` }}</dd></div>
      </dl>
      <section class="dashboard-completion-chart" aria-label="近7天每日完成任务数">
        <h3>近7天每日完成</h3>
        <ol><li v-for="day in stats.days" :key="day.date"><span class="dashboard-completion-bar" :style="{ '--completion-bar': `${day.count / peak * 100}%` }" aria-hidden="true" /><strong>{{ day.count }}</strong><time :datetime="day.date">{{ day.date.slice(5).replace('-', '/') }}</time></li></ol>
      </section>
      <p class="dashboard-completion-caption">本周从周一零点开始。按时率基于本周已记录完成时间和截止时间的 {{ stats.eligibleCount }} 项任务计算。<template v-if="stats.weekWithoutDeadline">另有 {{ stats.weekWithoutDeadline }} 项没有截止时间，未计入按时率。</template></p>
      <p v-if="stats.missingTimeCount" class="dashboard-notice dashboard-warning">当前有 {{ stats.missingTimeCount }} 项已完成任务缺少有效完成时间，未纳入上述统计。</p>
    </template>
    <div v-else class="dashboard-completion-unavailable"><h3>暂无完成时间记录</h3><p>当前 {{ stats.doneCount }} 项已完成任务尚无有效完成时间，暂时无法统计近期趋势和按时完成率。</p><p>记录真实完成时间后，这里会自动更新。</p></div>
  </DashboardDialog>
</template>
