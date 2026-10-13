export interface SiteNotice {
  id: string
  kind: 'success' | 'error'
  title: string
  message: string
}

export const useSiteNotice = () => {
  const notices = useState<SiteNotice[]>('site-notices', () => [])
  const dismiss = (id: string) => { notices.value = notices.value.filter(item => item.id !== id) }
  const show = (kind: SiteNotice['kind'], message: string, title?: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    notices.value = [...notices.value.slice(-2), { id, kind, message, title: title || (kind === 'success' ? '操作成功' : '操作未完成') }]
    if (import.meta.client) setTimeout(() => dismiss(id), kind === 'success' ? 6500 : 9000)
  }
  return { notices, dismiss, success: (message: string, title?: string) => show('success', message, title), error: (message: string) => show('error', message) }
}
