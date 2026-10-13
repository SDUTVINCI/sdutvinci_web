interface SiteConfirmation { title: string, message: string }
let resolveConfirmation: ((accepted: boolean) => void) | undefined

export const useSiteConfirm = () => {
  const confirmation = useState<SiteConfirmation | null>('site-confirmation', () => null)
  const settle = (accepted: boolean) => {
    const resolve = resolveConfirmation
    resolveConfirmation = undefined
    confirmation.value = null
    resolve?.(accepted)
  }
  const confirm = (message: string, title = '请确认本次操作') => {
    if (!import.meta.client) return Promise.resolve(false)
    settle(false)
    confirmation.value = { title, message }
    return new Promise<boolean>(resolve => { resolveConfirmation = resolve })
  }
  return { confirmation, confirm, settle }
}
