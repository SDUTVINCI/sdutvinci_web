<script setup lang="ts">
import type { CmsMember } from '~~/shared/types/cms-members'
import { resolveStaticMediaUrl } from '~~/shared/utils/static-media'

const props = defineProps<{
  modelValue: string[]
  members: CmsMember[]
  multiple?: boolean
  disabled?: boolean
  emptyLabel: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()
const picker = ref<HTMLDetailsElement | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)
const query = ref('')
const memberByKey = computed(() => new Map(props.members.map(member => [member.memberKey, member])))
const selectedMembers = computed(() => props.modelValue.map(key => memberByKey.value.get(key)).filter(Boolean) as CmsMember[])
const filteredMembers = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase()
  if (!keyword) return props.members
  return props.members.filter(member => `${member.name}\n${member.memberKey}`.toLocaleLowerCase().includes(keyword))
})

const handleToggle = () => {
  if (picker.value?.open) nextTick(() => searchInput.value?.focus())
  else query.value = ''
}

const select = (memberKey: string) => {
  if (props.disabled) return
  if (!props.multiple) {
    emit('update:modelValue', [memberKey])
    picker.value?.removeAttribute('open')
    return
  }
  emit('update:modelValue', props.modelValue.includes(memberKey)
    ? props.modelValue.filter(key => key !== memberKey)
    : [...props.modelValue, memberKey])
}
</script>

<template>
  <details ref="picker" class="cms-member-picker" :class="{ 'is-disabled': disabled }" @toggle="handleToggle">
    <summary :aria-disabled="disabled">
      <span v-if="selectedMembers.length" class="cms-member-picker-selected">
        <span v-for="member in selectedMembers" :key="member.memberKey" class="cms-member-picker-person">
          <img :src="resolveStaticMediaUrl(member.avatarUrl || '/images/logo.png')" alt="" loading="lazy">
          <span>{{ member.name }}</span>
        </span>
      </span>
      <span v-else class="cms-muted">{{ emptyLabel }}</span>
      <span class="cms-member-picker-chevron" aria-hidden="true">⌄</span>
    </summary>
    <div class="cms-member-picker-menu">
      <div class="cms-member-picker-search">
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
      </div>
      <button
        v-for="member in filteredMembers"
        :key="member.memberKey"
        type="button"
        :class="{ 'is-selected': modelValue.includes(member.memberKey) }"
        :disabled="disabled"
        @click="select(member.memberKey)"
      >
        <span class="cms-member-picker-indicator" aria-hidden="true">{{ modelValue.includes(member.memberKey) ? '✓' : '' }}</span>
        <img :src="resolveStaticMediaUrl(member.avatarUrl || '/images/logo.png')" alt="" loading="lazy">
        <span><strong>{{ member.name }}</strong><small>{{ member.memberKey }}</small></span>
      </button>
      <p v-if="!filteredMembers.length" class="cms-member-picker-empty">没有匹配的成员</p>
    </div>
  </details>
</template>
