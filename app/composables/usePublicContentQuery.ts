import type {
  PublicContentCollection,
  PublicContentSourceConfig
} from '../../shared/types/public-content'
import type { Ref, WatchSource } from 'vue'

interface PublicContentQueryOptions<T> {
  key: string | Ref<string>
  collection: PublicContentCollection
  legacy: () => Promise<T>
  database: () => Promise<T>
  watch?: WatchSource[]
}

interface PublicContentQueryEnvelope<T> {
  value: T
  renderer: 'nuxt_content' | 'comark'
  mode: PublicContentSourceConfig['sources'][PublicContentCollection]
}

export const usePublicContentQuery = async <T>(
  options: PublicContentQueryOptions<T>
) => {
  const requestFetch = import.meta.server ? useRequestFetch() : $fetch
  const result = await useAsyncData<PublicContentQueryEnvelope<T>>(
    options.key,
    async () => {
      const sourceConfig = await requestFetch<PublicContentSourceConfig>(
        '/api/v2/content/config'
      )
      const mode = sourceConfig.sources[options.collection] || 'legacy_git'
      if (mode === 'database') {
        return {
          value: await options.database(),
          renderer: 'comark',
          mode
        }
      }

      if (mode === 'database_shadow') {
        const [legacyResult, databaseResult] = await Promise.allSettled([
          options.legacy(),
          options.database()
        ])
        if (legacyResult.status === 'rejected') throw legacyResult.reason
        if (databaseResult.status === 'rejected') {
          console.warn(
            `[phase4-shadow] ${options.collection} 数据库候选查询失败，响应继续使用 legacy_git`
          )
        }
        return {
          value: legacyResult.value,
          renderer: 'nuxt_content',
          mode
        }
      }

      return {
        value: await options.legacy(),
        renderer: 'nuxt_content',
        mode
      }
    },
    { watch: options.watch }
  )

  return {
    data: computed(() => result.data.value?.value),
    renderer: computed(() => result.data.value?.renderer || 'nuxt_content'),
    mode: computed(() => result.data.value?.mode || 'legacy_git'),
    pending: result.pending,
    error: result.error,
    refresh: result.refresh
  }
}
