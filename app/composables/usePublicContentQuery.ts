import type { Ref, WatchSource } from 'vue'

interface PublicContentQueryOptions<T> {
  key: string | Ref<string>
  database: (requestFetch: ReturnType<typeof useRequestFetch>) => Promise<T>
  watch?: WatchSource[]
}

interface PublicContentQueryEnvelope<T> {
  value: T
}

export const usePublicContentQuery = async <T>(
  options: PublicContentQueryOptions<T>
) => {
  const { session } = useCmsSession()
  const requestFetch = useRequestFetch()
  const result = await useAsyncData<PublicContentQueryEnvelope<T>>(
    options.key,
    async () => ({ value: await options.database(requestFetch) }),
    { watch: [...(options.watch || []), session] }
  )

  return {
    data: computed(() => result.data.value?.value),
    pending: result.pending,
    error: result.error,
    refresh: result.refresh
  }
}
