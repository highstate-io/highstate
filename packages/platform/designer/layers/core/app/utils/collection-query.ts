import type { CollectionQuery, CollectionQueryResult } from "@highstate/backend/shared"

export type ObservedCollectionQueryResult<T> = CollectionQueryResult<T> & {
  total: number
  hasMore: boolean
  hasNextPage: boolean
  error: string | null
}

export function useCollectionQuery<T>(
  queryFn: (query: CollectionQuery) => Promise<CollectionQueryResult<T>>,
) {
  const isLoading = ref(false)
  const search = ref("")
  const sortBy = ref<CollectionQuery["sortBy"]>([])
  const page = ref(1)
  const itemsPerPage = ref(10)
  const debouncedSearch = debouncedRef(search, 300)
  const pages = shallowRef<CollectionQueryResult<T>[]>([])
  const data = shallowRef<ObservedCollectionQueryResult<T>>({
    items: [],
    total: 0,
    hasMore: false,
    hasNextPage: false,
    error: null,
  })
  const { on: onReload, trigger: triggerReload } = createEventHook<[]>()
  const query = computed<CollectionQuery>(() => ({
    pageSize: itemsPerPage.value,
    sortBy: sortBy.value,
    search: debouncedSearch.value,
  }))

  function updateData(): void {
    const currentPage = pages.value[page.value - 1]
    const lastPage = pages.value.at(-1)

    data.value = {
      items: currentPage?.items ?? [],
      total: pages.value.reduce((total, result) => total + result.items.length, 0),
      hasMore: Boolean(lastPage?.nextPageToken),
      hasNextPage: Boolean(pages.value[page.value] || currentPage?.nextPageToken),
      error: data.value.error,
    }
  }

  async function load(force = true): Promise<void> {
    const pageIndex = page.value - 1
    if (!force && pages.value[pageIndex]) {
      updateData()
      return
    }

    const previousPage = pages.value[pageIndex - 1]
    if (pageIndex > 0 && !previousPage?.nextPageToken) {
      page.value = Math.max(1, pages.value.length)
      updateData()
      return
    }

    isLoading.value = true
    data.value = { ...data.value, error: null }

    try {
      const result = await queryFn({
        ...query.value,
        pageToken: previousPage?.nextPageToken,
      })

      pages.value = [...pages.value.slice(0, pageIndex), result]
      updateData()
      triggerReload()
    } catch (caught) {
      data.value = {
        ...data.value,
        error: caught instanceof Error ? caught.message : "Failed to load collection",
      }
    } finally {
      isLoading.value = false
    }
  }

  function reset(): void {
    pages.value = []
    page.value = 1
    data.value = { ...data.value, error: null }
    updateData()
  }

  watch(query, async () => {
    pages.value = []
    if (page.value !== 1) {
      page.value = 1
      return
    }

    updateData()
    await load()
  })
  watch(page, async () => await load(false))

  return { search, sortBy, page, itemsPerPage, isLoading, data, reset, load, onReload }
}

export async function loadAllCollectionItems<T>(
  queryFn: (query: CollectionQuery) => Promise<CollectionQueryResult<T>>,
): Promise<T[]> {
  const items: T[] = []
  let pageToken: string | undefined

  do {
    const result = await queryFn({ pageSize: 100, pageToken })
    items.push(...result.items)
    pageToken = result.nextPageToken
  } while (pageToken)

  return items
}
