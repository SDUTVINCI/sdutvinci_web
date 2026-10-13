import type { Ref } from 'vue'

export const useFormNotices = (message: Ref<string>, errorMessage: Ref<string>) => {
  const notice = useSiteNotice()
  watch(message, value => {
    if (value) notice.success(value, /提交/.test(value) ? '提交成功' : /审核/.test(value) ? '审核操作完成' : /撤回/.test(value) ? '已撤回' : '操作成功')
  }, { flush: 'sync' })
  watch(errorMessage, value => { if (value) notice.error(value) }, { flush: 'sync' })
}
