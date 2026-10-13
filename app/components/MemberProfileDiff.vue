<script setup lang="ts">
defineProps<{ changes: Record<string, any> }>()
const labels: Record<string, string> = { memberKey: '成员稳定 ID', teacherDetails: '任职与职称补充信息', name: '姓名', image: '头像', role: '身份／职务', type: '成员类型', time: '参加过的赛季', advisor: '顾问届次', grade: '年级', affiliation: '学院／单位', links: '个人链接', body: '简介', metadata: '扩展资料', sortOrder: '排序', isLearner: '是否为新学员', group: '组别', positions: '职务' }
const display = (value: unknown) => typeof value === 'boolean' ? (value ? '是' : '否') : value == null || value === '' ? '未填写' : Array.isArray(value) ? (value.join('、') || '未填写') : typeof value === 'object' ? JSON.stringify(value) : String(value)
</script>
<template>
  <dl class="member-profile-diff"><div v-for="(change, key) in changes" :key="key"><dt>{{ labels[String(key)] || key }}</dt><dd><span>原：{{ display(change.from) }}</span><strong>申请：{{ display(change.to) }}</strong></dd></div></dl>
</template>
<style scoped>
.member-profile-diff { display: grid; gap: 12px; margin: 16px 0; }
.member-profile-diff > div { padding: 12px; border: 1px solid var(--line); border-radius: 8px; }
dt { font-weight: 700; } dd { margin: 8px 0 0; display: grid; gap: 6px; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 280px; overflow: auto; }
</style>
