<script setup lang="ts">
definePageMeta({
  layout: 'cms',
  middleware: 'cms-auth'
})
useHead({ title: '个人资料 · Vinci 内容管理后台' })

const { session, csrfHeaders } = useCmsSession()
const displayName = ref(session.value?.user.displayName ?? '')
const saving = ref(false)
const message = ref('')
const isError = ref(false)

watch(
  () => session.value?.user.displayName,
  value => {
    if (value) {
      displayName.value = value
    }
  },
  { immediate: true }
)

const save = async () => {
  saving.value = true
  message.value = ''
  isError.value = false

  try {
    const result = await $fetch<{ user: NonNullable<typeof session.value>['user'] }>(
      '/api/cms/profile',
      {
        method: 'PATCH',
        headers: csrfHeaders(),
        body: { displayName: displayName.value }
      }
    )
    if (session.value) {
      session.value.user = result.user
    }
    message.value = '资料已保存'
  } catch (error: any) {
    isError.value = true
    message.value = error?.data?.message
      ?? error?.data?.statusMessage
      ?? '保存失败，请稍后重试'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="cms-page cms-page-narrow">
    <header class="cms-page-header">
      <p class="cms-eyebrow">
        PROFILE
      </p>
      <h1>个人资料</h1>
      <p>更新后台中显示的名称。账号 ID、邮箱和权限由管理员维护。</p>
    </header>

    <form
      class="cms-panel cms-form"
      @submit.prevent="save"
    >
      <label>
        <span>账号 ID</span>
        <input
          :value="session?.user.account"
          type="text"
          disabled
        >
      </label>

      <label>
        <span>联系邮箱</span>
        <input
          :value="session?.user.email"
          type="email"
          disabled
        >
      </label>

      <label>
        <span>显示名称</span>
        <input
          v-model.trim="displayName"
          type="text"
          maxlength="100"
          required
        >
      </label>

      <p
        v-if="message"
        class="cms-alert"
        :class="{ 'cms-alert-error': isError }"
        role="status"
      >
        {{ message }}
      </p>

      <button
        class="cms-button cms-button-primary"
        type="submit"
        :disabled="saving"
      >
        {{ saving ? '正在保存…' : '保存资料' }}
      </button>
    </form>
  </section>
</template>
