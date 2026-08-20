<script setup lang="ts">
import type { AccountRegistrationMemberOption } from '~~/shared/types/account-registration'
import { cmsPasswordMinLength } from '~~/shared/types/cms-auth'

definePageMeta({ layout: 'cms-auth' })
useHead({ title: '登录或注册 · Vinci 内容管理后台' })

const { loadSession, login } = useCmsSession()
const route = useRoute()
const mode = ref<'login' | 'register'>('login')
const account = ref('')
const password = ref('')
const submitting = ref(false)
const errorMessage = ref('')
const registrationMemberId = ref('')
const registrationPassword = ref('')
const registrationConfirmation = ref('')
const registrationSubmitting = ref(false)
const registrationError = ref('')
const registrationSuccess = ref('')
const requestFetch = import.meta.server ? useRequestFetch() : $fetch
const {
  data: registrationData,
  status: registrationStatus,
  error: registrationLoadError,
  refresh: refreshRegistrationMembers
} = await useAsyncData('account-registration:members', () =>
  requestFetch<{ members: AccountRegistrationMemberOption[] }>('/api/account-registrations/members'), {
    default: () => ({ members: [] })
  }
)
const registrationMembers = computed(() => registrationData.value?.members ?? [])
const selectedRegistrationMember = computed(() => (
  registrationMembers.value.find(member => member.id === registrationMemberId.value) || null
))

watch(registrationMemberId, () => {
  registrationError.value = ''
  registrationSuccess.value = ''
})

const safeRedirect = computed(() => {
  const value = typeof route.query.redirect === 'string' ? route.query.redirect : ''
  return value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')
    ? value
    : '/cms'
})
const returnsToArticle = computed(() => (
  safeRedirect.value.startsWith('/news/') || safeRedirect.value.startsWith('/wiki/')
))

onMounted(async () => {
  if (await loadSession(true)) {
    await navigateTo(safeRedirect.value)
  }
})

const switchMode = async (nextMode: 'login' | 'register') => {
  mode.value = nextMode
  errorMessage.value = ''
  registrationError.value = ''
  registrationSuccess.value = ''
  if (nextMode === 'register' && !registrationMembers.value.length) {
    await refreshRegistrationMembers()
  }
}

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

const submitRegistration = async () => {
  registrationError.value = ''
  registrationSuccess.value = ''
  const member = selectedRegistrationMember.value
  if (!member) {
    registrationError.value = '请先选择你的成员信息。'
    return
  }
  if (member.registrationStatus === 'registered') {
    registrationError.value = '该成员已经注册账号；如需找回密码，请联系 Vinci 机器人队管理员。'
    return
  }
  if (member.registrationStatus === 'pending') {
    registrationError.value = '该成员已有待审核的注册申请，请勿重复提交。'
    return
  }
  if (registrationPassword.value !== registrationConfirmation.value) {
    registrationError.value = '两次输入的密码不一致。'
    return
  }
  registrationSubmitting.value = true
  try {
    const result = await $fetch<{ account: string }>('/api/account-registrations', {
      method: 'POST',
      body: {
        memberId: member.id,
        password: registrationPassword.value
      }
    })
    registrationSuccess.value = `账号 @${result.account} 的注册申请已提交。管理员审核通过后即可登录。`
    registrationPassword.value = ''
    registrationConfirmation.value = ''
    await refreshRegistrationMembers()
  } catch (error: any) {
    registrationError.value = error?.data?.message
      ?? error?.data?.statusMessage
      ?? '注册申请提交失败，请稍后重试'
  } finally {
    registrationSubmitting.value = false
  }
}
</script>

<template>
  <div class="cms-login-stage">
    <section class="cms-login-story" aria-labelledby="cms-login-story-title">
      <p class="cms-login-kicker"><span aria-hidden="true" />VINCI TEAM · CMS</p>
      <h1 id="cms-login-story-title">让每一次灵感<br><em>抵达赛场。</em></h1>
      <p class="cms-login-intro">从内容记录到审核发布，在一个可靠的工作台里沉淀 Vinci 的每一步成长。</p>
      <ul class="cms-login-capabilities" aria-label="后台能力">
        <li><span>01</span><strong>内容编排</strong><small>Markdown 与媒体资源</small></li>
        <li><span>02</span><strong>协作审核</strong><small>状态流转与权限控制</small></li>
        <li><span>03</span><strong>安全发布</strong><small>Git 版本化内容发布</small></li>
      </ul>
    </section>

    <section class="cms-auth-card" :class="{ 'cms-registration-card': mode === 'register' }">
      <div class="cms-login-card-heading">
        <p class="cms-eyebrow">{{ mode === 'login' ? 'SECURE ACCESS' : 'MEMBER SIGN UP' }}</p>
        <span class="cms-login-status"><i aria-hidden="true" />SYSTEM ONLINE</span>
      </div>
      <div class="cms-auth-mode-switch" aria-label="登录或注册">
        <button type="button" :class="{ active: mode === 'login' }" @click="switchMode('login')">账号登录</button>
        <button type="button" :class="{ active: mode === 'register' }" @click="switchMode('register')">申请注册</button>
      </div>

      <template v-if="mode === 'login'">
        <h2>欢迎回来</h2>
        <p class="cms-muted">{{ returnsToArticle ? '登录后将自动返回原文章。' : '使用队内成员账号进入内容管理后台。' }}</p>
        <form class="cms-form cms-login-form" @submit.prevent="submit">
          <label class="cms-login-field">
            <span class="cms-login-field-label"><span>账号</span><small>ACCOUNT</small></span>
            <span class="cms-login-input"><span class="cms-login-field-index" aria-hidden="true">01</span><input v-model.trim="account" type="text" autocomplete="username" maxlength="32" autocapitalize="none" spellcheck="false" placeholder="请输入账号" required></span>
          </label>
          <label class="cms-login-field">
            <span class="cms-login-field-label"><span>密码</span><small>PASSWORD</small></span>
            <span class="cms-login-input"><span class="cms-login-field-index" aria-hidden="true">02</span><input v-model="password" type="password" autocomplete="current-password" placeholder="请输入密码" required></span>
          </label>
          <p v-if="errorMessage" class="cms-alert cms-alert-error" role="alert">{{ errorMessage }}</p>
          <button class="cms-button cms-button-primary cms-login-submit" type="submit" :disabled="submitting"><span>{{ submitting ? '正在验证身份…' : (returnsToArticle ? '登录并返回文章' : '进入工作台') }}</span><span aria-hidden="true">{{ submitting ? '···' : '↗' }}</span></button>
        </form>
      </template>

      <template v-else>
        <h2>申请成员账号</h2>
        <p class="cms-muted">先认领已审核上线的成员信息，再设置密码；账号需管理员审核后启用。</p>
        <form class="cms-form cms-login-form cms-registration-form" @submit.prevent="submitRegistration">
          <label class="cms-login-field">
            <span class="cms-login-field-label"><span>成员信息</span><small>MEMBER PROFILE</small></span>
            <CmsAccountRegistrationMemberPicker v-model="registrationMemberId" :members="registrationMembers" :loading="registrationStatus === 'pending'" />
          </label>
          <p v-if="registrationLoadError" class="cms-alert cms-alert-error" role="alert">成员信息加载失败，请稍后重试。</p>
          <p class="cms-registration-help">
            <span>找不到自己？</span>
            <NuxtLink class="cms-registration-profile-link" to="/team/apply"><span>先填写成员信息</span><span aria-hidden="true">↗</span></NuxtLink>
            <span>资料审核上线后再回来注册。</span>
          </p>
          <label class="cms-login-field">
            <span class="cms-login-field-label"><span>稳定账号 ID</span><small>READ ONLY</small></span>
            <span class="cms-login-input cms-login-input-readonly"><span class="cms-login-field-index" aria-hidden="true">ID</span><input :value="selectedRegistrationMember?.account || ''" type="text" readonly tabindex="-1" placeholder="选择成员后自动生成"></span>
          </label>
          <p v-if="selectedRegistrationMember?.registrationStatus === 'registered'" class="cms-alert cms-alert-error" role="alert">该成员已经注册账号；如需找回密码，请联系 Vinci 机器人队管理员。</p>
          <p v-else-if="selectedRegistrationMember?.registrationStatus === 'pending' && !registrationSuccess" class="cms-alert" role="status">该成员已有待审核的注册申请，请等待管理员处理。</p>
          <label class="cms-login-field">
            <span class="cms-login-field-label"><span>密码</span><small>MIN {{ cmsPasswordMinLength }}</small></span>
            <span class="cms-login-input"><span class="cms-login-field-index" aria-hidden="true">02</span><input v-model="registrationPassword" type="password" autocomplete="new-password" :minlength="cmsPasswordMinLength" maxlength="1024" placeholder="至少 12 个字符" required></span>
          </label>
          <label class="cms-login-field">
            <span class="cms-login-field-label"><span>确认密码</span><small>CONFIRM</small></span>
            <span class="cms-login-input"><span class="cms-login-field-index" aria-hidden="true">03</span><input v-model="registrationConfirmation" type="password" autocomplete="new-password" :minlength="cmsPasswordMinLength" maxlength="1024" placeholder="再次输入密码" required></span>
          </label>
          <p v-if="registrationSuccess" class="cms-alert" role="status">{{ registrationSuccess }}</p>
          <p v-if="registrationError" class="cms-alert cms-alert-error" role="alert">{{ registrationError }}</p>
          <button class="cms-button cms-button-primary cms-login-submit" type="submit" :disabled="registrationSubmitting || selectedRegistrationMember?.registrationStatus !== 'available'"><span>{{ registrationSubmitting ? '正在提交申请…' : '提交注册审核' }}</span><span aria-hidden="true">{{ registrationSubmitting ? '···' : '↗' }}</span></button>
        </form>
      </template>

      <p class="cms-login-note"><span aria-hidden="true">◆</span>{{ mode === 'login' ? '仅限获得授权的队内成员使用' : '注册默认获得普通成员身份，不会授予管理员权限' }}</p>
    </section>
  </div>
</template>
