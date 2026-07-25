import type { CmsSessionResponse } from '../../shared/types/cms-auth'

export const useCmsSession = () => {
  const session = useState<CmsSessionResponse | null>('cms-session', () => null)
  const loaded = useState<boolean>('cms-session-loaded', () => false)

  const loadSession = async (force = false) => {
    if (loaded.value && !force) {
      return session.value
    }

    try {
      const requestFetch = import.meta.server ? useRequestFetch() : $fetch
      session.value = await requestFetch<CmsSessionResponse>('/api/cms/auth/session')
    } catch {
      session.value = null
    } finally {
      loaded.value = true
    }

    return session.value
  }

  const login = async (email: string, password: string) => {
    session.value = await $fetch<CmsSessionResponse>('/api/cms/auth/login', {
      method: 'POST',
      body: { email, password }
    })
    loaded.value = true
    return session.value
  }

  const logout = async () => {
    if (session.value) {
      await $fetch('/api/cms/auth/logout', {
        method: 'POST',
        headers: {
          'x-csrf-token': session.value.csrfToken
        }
      })
    }

    session.value = null
    loaded.value = true
  }

  const csrfHeaders = () => {
    if (!session.value) {
      throw new Error('当前没有有效会话')
    }

    return { 'x-csrf-token': session.value.csrfToken }
  }

  return {
    session,
    loaded,
    loadSession,
    login,
    logout,
    csrfHeaders
  }
}
