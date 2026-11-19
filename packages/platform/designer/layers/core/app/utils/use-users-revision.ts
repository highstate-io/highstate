import type { MaybeRefOrGetter } from "vue"

export function useUsersRevision(
  projectId: string | undefined,
  userId: MaybeRefOrGetter<string | undefined>,
  enabled: MaybeRefOrGetter<boolean>,
  changed: () => void,
  includeBindings: MaybeRefOrGetter<boolean> = false,
) {
  const { $client } = useNuxtApp()

  watch(
    () => [toValue(enabled), toValue(userId), toValue(includeBindings)] as const,
    ([allowed, selected, bindings], _, onCleanup) => {
      if (!allowed) {
        return
      }

      let stopped = false
      let retry: ReturnType<typeof setTimeout> | undefined
      let subscription: { unsubscribe: () => void } | undefined

      const connect = () => {
        if (stopped) {
          return
        }

        const observer = {
          onData: () => {
            if (!stopped) {
              changed()
            }
          },
          onError: () => {
            if (stopped) {
              return
            }

            changed()
            retry = setTimeout(connect, 1000)
          },
        }

        subscription?.unsubscribe()

        subscription = projectId
          ? $client.projectUserSettings.watch.subscribe(
              { projectId, userId: selected, bindings },
              observer,
            )
          : $client.backendUserSettings.watch.subscribe({ userId: selected, bindings }, observer)
      }

      connect()

      onCleanup(() => {
        stopped = true
        clearTimeout(retry)
        subscription?.unsubscribe()
      })
    },
    { immediate: true },
  )
}
