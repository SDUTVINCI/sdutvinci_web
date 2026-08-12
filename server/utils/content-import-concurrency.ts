export const CONTENT_PR_IMPORT_PLAN_CONCURRENCY = 10

export const mapContentImportConcurrently = async <Input, Output>(
  items: readonly Input[],
  mapper: (item: Input, index: number) => Promise<Output>
): Promise<Output[]> => {
  const results = new Array<Output>(items.length)
  let nextIndex = 0
  const workerCount = Math.min(CONTENT_PR_IMPORT_PLAN_CONCURRENCY, items.length)

  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      if (index >= items.length) return
      results[index] = await mapper(items[index]!, index)
    }
  })

  await Promise.all(workers)
  return results
}
