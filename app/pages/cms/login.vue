<script setup lang="ts">
definePageMeta({ layout: 'cms-auth' })
useHead({ title: '登录 · Vinci 内容管理后台' })

const { loadSession, login } = useCmsSession()
const email = ref('')
const password = ref('')
const submitting = ref(false)
const errorMessage = ref('')

onMounted(async () => {
  if (await loadSession(true)) {
    await navigateTo('/cms')
  }
})

const submit = async () => {
  submitting.value = true
  errorMessage.value = ''

  try {
    await login(email.value, password.value)
    await navigateTo('/cms')
  } catch (error: any) {
    errorMessage.value = error?.data?.message
      ?? error?.data?.statusMessage
      ?? '登录失败，请稍后重试'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <section class="cms-auth-card">
    <p class="cms-eyebrow">
      CONTENT MANAGEMENT SYSTEM
    </p>
    <h1>登录后台</h1>
    <p class="cms-muted">
      使用管理员为你创建的账号登录。
    </p>

    <form
      class="cms-form"
      @submit.prevent="submit"
    >
      <label>
        <span>邮箱</span>
        <input
          v-model.trim="email"
          type="email"
          autocomplete="username"
          maxlength="320"
          required
        >
      </label>

      <label>
        <span>密码</span>
        <input
          v-model="password"
          type="password"
          autocomplete="current-password"
          required
        >
      </label>

      <p
        v-if="errorMessage"
        class="cms-alert cms-alert-error"
        role="alert"
      >
        {{ errorMessage }}
      </p>

      <button
        class="cms-button cms-button-primary"
        type="submit"
        :disabled="submitting"
      >
        {{ submitting ? '正在登录…' : '登录' }}
      </button>
    </form>
  </section>
</template>
