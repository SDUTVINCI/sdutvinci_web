<script setup lang="ts">
import type { AccountRegistrationMemberOption } from '~~/shared/types/account-registration'
import { resolveStaticMediaUrl } from '~~/shared/utils/static-media'

const props = defineProps<{
  modelValue: string
  members: AccountRegistrationMemberOption[]
  loading?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const picker = ref<HTMLDetailsElement | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)
const query = ref('')
const selected = computed(() => props.members.find(member => member.id === props.modelValue) || null)
const filteredMembers = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase()
  if (!keyword) return props.members
  return props.members.filter(member => (
    `${member.name}\n${member.memberKey}\n${member.account}`
      .toLocaleLowerCase()
      .includes(keyword)
  ))
})
const statusLabel = (status: AccountRegistrationMemberOption['registrationStatus']) => ({
  available: '可申请',
  pending: '审核中',
  registered: '已注册'
})[status]
const handleToggle = () => {
  if (picker.value?.open) nextTick(() => searchInput.value?.focus())
  else query.value = ''
}
const select = (id: string) => {
  emit('update:modelValue', id)
  picker.value?.removeAttribute('open')
}
</script>

<template>
  <details ref="picker" class="cms-registration-member-picker" @toggle="handleToggle">
    <summary>
      <span v-if="selected" class="cms-registration-member-selected">
        <img :src="resolveStaticMediaUrl(selected.avatarUrl || '/images/logo.png')" alt="">
        <span><strong>{{ selected.name }}</strong><small>{{ selected.memberKey }}</small></span>
        <em :data-status="selected.registrationStatus">{{ statusLabel(selected.registrationStatus) }}</em>
      </span>
      <span v-else class="cms-registration-member-placeholder">
        {{ loading ? '正在加载成员信息…' : '搜索并选择你的成员信息' }}
      </span>
      <span class="cms-member-picker-chevron" aria-hidden="true">⌄</span>
    </summary>
    <div class="cms-registration-member-menu">
      <label class="cms-registration-member-search">
        <span aria-hidden="true">⌕</span>
        <input
          ref="searchInput"
          v-model="query"
          type="search"
          placeholder="搜索姓名或稳定 ID"
          aria-label="搜索成员"
          autocomplete="off"
          @keydown.stop
        >
      </label>
      <button
        v-for="member in filteredMembers"
        :key="member.id"
        type="button"
        :class="{ 'is-selected': member.id === modelValue }"
        @click="select(member.id)"
      >
        <span class="cms-member-picker-indicator" aria-hidden="true">{{ member.id === modelValue ? '✓' : '' }}</span>
        <img :src="resolveStaticMediaUrl(member.avatarUrl || '/images/logo.png')" alt="" loading="lazy">
        <span><strong>{{ member.name }}</strong><small>{{ member.memberKey }}</small></span>
        <em :data-status="member.registrationStatus">{{ statusLabel(member.registrationStatus) }}</em>
      </button>
      <p v-if="!filteredMembers.length" class="cms-member-picker-empty">没有匹配的成员信息</p>
    </div>
  </details>
</template>
