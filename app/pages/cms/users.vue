<script setup lang="ts">
import {
  cmsAccountPattern,
  cmsPasswordMinLength,
  cmsRoleCodes
} from '~~/shared/types/cms-auth'
import type {
  CmsManagedUser,
  CmsRoleCode
} from '~~/shared/types/cms-auth'
import { resolveStaticMediaUrl } from '~~/shared/utils/static-media'

definePageMeta({
  layout: 'cms',
  middleware: 'cms-auth'
})
useHead({ title: '账号管理 · Vinci 内容管理后台' })

interface UserEditForm {
  status: 'active' | 'disabled'
  role: CmsRoleCode
  password: string
}

const { session, csrfHeaders, loadSession } = useCmsSession()
const isAdmin = computed(() => session.value?.user.roles.includes('admin') ?? false)
const requestFetch = import.meta.server ? useRequestFetch() : $fetch
const roleLabels: Record<CmsRoleCode, string> = {
  admin: '管理员',
  member: '成员'
}
const roleOptions = cmsRoleCodes.map(code => ({
  code,
  label: roleLabels[code]
}))

const {
  data,
  status,
  error,
  refresh
} = await useAsyncData('cms:users', async () => {
  if (!isAdmin.value) {
    return { users: [] as CmsManagedUser[] }
  }

  return requestFetch<{ users: CmsManagedUser[] }>('/api/cms/admin/users')
})
const users = computed(() => data.value?.users ?? [])
const userForms = reactive<Record<string, UserEditForm>>({})
const savingUserId = ref('')
const accountMessage = ref('')
const accountError = ref('')

watch(users, (currentUsers) => {
  for (const user of currentUsers) {
    userForms[user.id] = {
      status: user.status,
      role: user.roles[0] || 'member',
      password: ''
    }
  }
}, { immediate: true })

const newUser = reactive<{
  account: string
  password: string
  role: CmsRoleCode
}>({
  account: '',
  password: '',
  role: 'member'
})
const creating = ref(false)
const createMessage = ref('')
const createError = ref('')

const ownPassword = reactive({
  current: '',
  next: '',
  confirmation: ''
})
const changingOwnPassword = ref(false)
const passwordMessage = ref('')
const passwordError = ref('')

const errorMessage = (error: any, fallback: string) =>
  error?.data?.message
  ?? error?.data?.statusMessage
  ?? fallback

const createUser = async () => {
  creating.value = true
  createMessage.value = ''
  createError.value = ''

  try {
    await $fetch('/api/cms/admin/users', {
      method: 'POST',
      headers: csrfHeaders(),
      body: {
        account: newUser.account,
        password: newUser.password,
        roles: [newUser.role]
      }
    })
    createMessage.value = `账号 @${newUser.account} 已创建。`
    newUser.account = ''
    newUser.password = ''
    newUser.role = 'member'
    await refresh()
  } catch (error: any) {
    createError.value = errorMessage(error, '创建账号失败')
  } finally {
    creating.value = false
  }
}

const saveUser = async (user: CmsManagedUser) => {
  const form = userForms[user.id]
  if (!form) return

  const body: {
    status?: 'active' | 'disabled'
    roles?: CmsRoleCode[]
    password?: string
  } = {}
  if (form.status !== user.status) body.status = form.status
  if (user.roles.length !== 1 || form.role !== user.roles[0]) body.roles = [form.role]
  if (form.password) body.password = form.password

  if (Object.keys(body).length === 0) {
    accountError.value = '没有需要保存的修改。'
    return
  }

  savingUserId.value = user.id
  accountMessage.value = ''
  accountError.value = ''

  try {
    await $fetch(`/api/cms/admin/users/${user.id}`, {
      method: 'PATCH',
      headers: csrfHeaders(),
      body
    })
    accountMessage.value = `账号 @${user.account} 已更新。`

    if (user.id === session.value?.user.id) {
      const currentSession = await loadSession(true)
      if (!currentSession) {
        await navigateTo('/cms/login')
        return
      }
    }
    await refresh()
  } catch (error: any) {
    accountError.value = errorMessage(error, '更新账号失败')
  } finally {
    savingUserId.value = ''
  }
}

const deleteUser = async (user: CmsManagedUser) => {
  if (user.id === session.value?.user.id) return
  if (!confirm(`确定删除账号 @${user.account}？该账号会立即退出，且不再出现在账号列表中。`)) return
  savingUserId.value = user.id
  accountMessage.value = ''
  accountError.value = ''
  try {
    await $fetch(`/api/cms/admin/users/${user.id}`, {
      method: 'DELETE',
      headers: csrfHeaders(),
      body: { confirmation: 'DELETE_USER' }
    })
    accountMessage.value = `账号 @${user.account} 已删除。`
    await refresh()
  } catch (error: any) {
    accountError.value = errorMessage(error, '删除账号失败')
  } finally {
    savingUserId.value = ''
  }
}

const changeOwnPassword = async () => {
  passwordMessage.value = ''
  passwordError.value = ''

  if (ownPassword.next !== ownPassword.confirmation) {
    passwordError.value = '两次输入的新密码不一致。'
    return
  }

  changingOwnPassword.value = true
  try {
    await $fetch('/api/cms/profile/password', {
      method: 'PATCH',
      headers: csrfHeaders(),
      body: {
        currentPassword: ownPassword.current,
        newPassword: ownPassword.next
      }
    })
    ownPassword.current = ''
    ownPassword.next = ''
    ownPassword.confirmation = ''
    passwordMessage.value = '密码已修改，其他设备上的登录会话已退出。'
  } catch (error: any) {
    passwordError.value = errorMessage(error, '密码修改失败')
  } finally {
    changingOwnPassword.value = false
  }
}
</script>

<template>
  <section class="cms-page">
    <header class="cms-page-header cms-page-header-actions">
      <div>
        <p class="cms-eyebrow">ACCOUNT SECURITY</p>
        <h1>{{ isAdmin ? '账号管理' : '账号安全' }}</h1>
        <p>
          {{ isAdmin
            ? '创建成员账号，维护身份与状态，并在必要时安全重置密码。'
            : '查看自己的账号信息并修改密码。身份与账号状态由管理员维护。' }}
        </p>
      </div>
    </header>

    <div class="cms-account-layout">
      <section class="cms-panel cms-account-own">
        <div class="cms-account-heading">
          <img
            :src="resolveStaticMediaUrl(session?.user.member?.avatarUrl || '/images/logo.png')"
            :alt="`${session?.user.member?.name || session?.user.account}的头像`"
          >
          <div>
            <span class="cms-muted">当前账号</span>
            <h2>{{ session?.user.member?.name || session?.user.account }}</h2>
            <p>
              @{{ session?.user.account }} ·
              {{ session?.user.roles.map(role => roleLabels[role]).join('、') }}
            </p>
          </div>
        </div>

        <form class="cms-form" @submit.prevent="changeOwnPassword">
          <h3>修改我的密码</h3>
          <label>
            <span>当前密码</span>
            <input
              v-model="ownPassword.current"
              type="password"
              autocomplete="current-password"
              required
            >
          </label>
          <label>
            <span>新密码</span>
            <input
              v-model="ownPassword.next"
              type="password"
              autocomplete="new-password"
              :minlength="cmsPasswordMinLength"
              maxlength="1024"
              required
            >
            <small>至少 {{ cmsPasswordMinLength }} 个字符。</small>
          </label>
          <label>
            <span>确认新密码</span>
            <input
              v-model="ownPassword.confirmation"
              type="password"
              autocomplete="new-password"
              :minlength="cmsPasswordMinLength"
              maxlength="1024"
              required
            >
          </label>
          <p v-if="passwordMessage" class="cms-alert" role="status">
            {{ passwordMessage }}
          </p>
          <p v-if="passwordError" class="cms-alert cms-alert-error" role="alert">
            {{ passwordError }}
          </p>
          <button
            class="cms-button cms-button-primary"
            type="submit"
            :disabled="changingOwnPassword"
          >
            {{ changingOwnPassword ? '正在修改…' : '修改密码' }}
          </button>
        </form>
      </section>

      <section v-if="isAdmin" class="cms-account-admin">
        <form class="cms-panel cms-form cms-account-create" @submit.prevent="createUser">
          <div>
            <p class="cms-eyebrow">NEW ACCOUNT</p>
            <h2>创建成员账号</h2>
          </div>
          <label>
            <span>稳定账号 ID</span>
            <input
              v-model.trim="newUser.account"
              type="text"
              autocomplete="off"
              autocapitalize="none"
              spellcheck="false"
              minlength="3"
              maxlength="32"
              pattern="[a-z][a-z0-9]{2,31}"
              placeholder="例如 dongjiahui"
              required
            >
            <small>建议与 member 的稳定 ID 一致，以便自动关联姓名和头像。</small>
          </label>
          <label>
            <span>初始密码</span>
            <input
              v-model="newUser.password"
              type="password"
              autocomplete="new-password"
              :minlength="cmsPasswordMinLength"
              maxlength="1024"
              required
            >
          </label>
          <fieldset class="cms-role-fieldset">
            <legend>身份</legend>
            <label
              v-for="role in roleOptions"
              :key="role.code"
            >
              <input v-model="newUser.role" type="radio" name="new-user-role" :value="role.code">
              <span>{{ role.label }}</span>
            </label>
          </fieldset>
          <p v-if="createMessage" class="cms-alert" role="status">
            {{ createMessage }}
          </p>
          <p v-if="createError" class="cms-alert cms-alert-error" role="alert">
            {{ createError }}
          </p>
          <button
            class="cms-button cms-button-primary"
            type="submit"
            :disabled="creating || !cmsAccountPattern.test(newUser.account)"
          >
            {{ creating ? '正在创建…' : '创建账号' }}
          </button>
        </form>

        <section class="cms-account-list-section">
          <div class="cms-account-list-heading">
            <div>
              <p class="cms-eyebrow">MEMBER ACCOUNTS</p>
              <h2>全部账号</h2>
            </div>
            <button
              class="cms-button cms-button-quiet"
              type="button"
              :disabled="status === 'pending'"
              @click="refresh()"
            >
              刷新
            </button>
          </div>

          <p v-if="status === 'pending'" class="cms-muted">正在加载账号…</p>
          <p v-else-if="error" class="cms-alert cms-alert-error" role="alert">
            {{ error.message || '账号加载失败' }}
          </p>
          <p v-if="accountMessage" class="cms-alert" role="status">
            {{ accountMessage }}
          </p>
          <p v-if="accountError" class="cms-alert cms-alert-error" role="alert">
            {{ accountError }}
          </p>

          <div class="cms-account-list">
            <article
              v-for="user in users"
              :key="user.id"
              class="cms-panel cms-account-card"
            >
              <header>
                <img
                  :src="resolveStaticMediaUrl(user.member?.avatarUrl || '/images/logo.png')"
                  :alt="`${user.member?.name || user.account}的头像`"
                  loading="lazy"
                  decoding="async"
                >
                <div>
                  <h3>{{ user.member?.name || user.account }}</h3>
                  <p>@{{ user.account }}</p>
                </div>
                <span
                  class="cms-badge"
                  :class="{ 'cms-badge-danger': user.status === 'disabled' }"
                >
                  {{ user.status === 'active' ? '正常' : '已停用' }}
                </span>
              </header>

              <form
                v-if="userForms[user.id]"
                class="cms-account-edit"
                @submit.prevent="saveUser(user)"
              >
                <label>
                  <span>账号状态</span>
                  <select v-model="userForms[user.id]!.status">
                    <option value="active">正常</option>
                    <option value="disabled">停用</option>
                  </select>
                </label>

                <fieldset class="cms-role-fieldset">
                  <legend>身份</legend>
                  <label
                    v-for="role in roleOptions"
                    :key="role.code"
                  >
                    <input
                      v-model="userForms[user.id]!.role"
                      type="radio"
                      :name="`user-role-${user.id}`"
                      :value="role.code"
                    >
                    <span>{{ role.label }}</span>
                  </label>
                </fieldset>

                <label v-if="user.id !== session?.user.id">
                  <span>重置密码</span>
                  <input
                    v-model="userForms[user.id]!.password"
                    type="password"
                    autocomplete="new-password"
                    :minlength="cmsPasswordMinLength"
                    maxlength="1024"
                    placeholder="留空则不修改"
                  >
                  <small>重置后，该账号所有已登录设备都会退出。</small>
                </label>
                <p v-else class="cms-muted">
                  当前账号请使用左侧“修改我的密码”，修改时会验证当前密码。
                </p>

                <div class="cms-form-actions">
                  <button
                    class="cms-button cms-button-primary"
                    type="submit"
                    :disabled="savingUserId === user.id"
                  >
                    {{ savingUserId === user.id ? '正在保存…' : '保存账号' }}
                  </button>
                  <button
                    v-if="user.id !== session?.user.id"
                    class="cms-button cms-button-danger"
                    type="button"
                    :disabled="savingUserId === user.id"
                    @click="deleteUser(user)"
                  >删除账号</button>
                </div>
              </form>
            </article>
          </div>
        </section>
      </section>
    </div>
  </section>
</template>
