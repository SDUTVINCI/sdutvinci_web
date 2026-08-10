<script setup lang="ts">
definePageMeta({ layout: 'cms-auth' })
useHead({ title: '登录 · Vinci 内容管理后台' })

const { loadSession, login } = useCmsSession()
const route = useRoute()
const account = ref('')
const password = ref('')
const submitting = ref(false)
const errorMessage = ref('')

const safeRedirect = computed(() => {
  const value = typeof route.query.redirect === 'string' ? route.query.redirect : ''
  return value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')
    ? value
    : '/cms'
})

onMounted(async () => {
  if (await loadSession(true)) {
    await navigateTo(safeRedirect.value)
  }
})

const submit = async () => {
  submitting.value = true
  errorMessage.value = ''

  try {
    await login(account.value, password.value)
    await navigateTo(safeRedirect.value)
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
  <div class="cms-login-stage">
    <section class="cms-login-story" aria-labelledby="cms-login-story-title">
      <p class="cms-login-kicker">
        <span aria-hidden="true" />
        VINCI TEAM · CMS
      </p>
      <h1 id="cms-login-story-title">
        让每一次灵感<br>
        <em>抵达赛场。</em>
      </h1>
      <p class="cms-login-intro">
        从内容记录到审核发布，在一个可靠的工作台里沉淀 Vinci 的每一步成长。
      </p>

      <ul class="cms-login-capabilities" aria-label="后台能力">
        <li>
          <span>01</span>
          <strong>内容编排</strong>
          <small>Markdown 与媒体资源</small>
        </li>
        <li>
          <span>02</span>
          <strong>协作审核</strong>
          <small>状态流转与权限控制</small>
        </li>
        <li>
          <span>03</span>
          <strong>安全发布</strong>
          <small>Git 版本化内容发布</small>
        </li>
      </ul>
    </section>

    <section class="cms-auth-card">
      <div class="cms-login-card-heading">
        <p class="cms-eyebrow">
          SECURE ACCESS
        </p>
        <span class="cms-login-status">
          <i aria-hidden="true" />
          SYSTEM ONLINE
        </span>
      </div>

      <h2>欢迎回来</h2>
      <p class="cms-muted">
        使用队内成员账号进入内容管理后台。
      </p>

      <form
        class="cms-form cms-login-form"
        @submit.prevent="submit"
      >
        <label class="cms-login-field">
          <span class="cms-login-field-label">
            <span>账号</span>
            <small>ACCOUNT</small>
          </span>
          <span class="cms-login-input">
            <span class="cms-login-field-index" aria-hidden="true">01</span>
            <input
              v-model.trim="account"
              type="text"
              autocomplete="username"
              maxlength="32"
              autocapitalize="none"
              spellcheck="false"
              placeholder="请输入账号"
              required
            >
          </span>
        </label>

        <label class="cms-login-field">
          <span class="cms-login-field-label">
            <span>密码</span>
            <small>PASSWORD</small>
          </span>
          <span class="cms-login-input">
            <span class="cms-login-field-index" aria-hidden="true">02</span>
            <input
              v-model="password"
              type="password"
              autocomplete="current-password"
              placeholder="请输入密码"
              required
            >
          </span>
        </label>

        <p
          v-if="errorMessage"
          class="cms-alert cms-alert-error"
          role="alert"
        >
          {{ errorMessage }}
        </p>

        <button
          class="cms-button cms-button-primary cms-login-submit"
          type="submit"
          :disabled="submitting"
        >
          <span>{{ submitting ? '正在验证身份…' : '进入工作台' }}</span>
          <span aria-hidden="true">{{ submitting ? '···' : '↗' }}</span>
        </button>
      </form>

      <p class="cms-login-note">
        <span aria-hidden="true">◆</span>
        仅限获得授权的队内成员使用
      </p>
    </section>
  </div>
</template>
