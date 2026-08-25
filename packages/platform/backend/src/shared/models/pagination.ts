export type PageRequest = {
  pageSize?: number
  pageToken?: string
}

export type PageResult<T> = {
  items: T[]
  nextPageToken?: string
}
