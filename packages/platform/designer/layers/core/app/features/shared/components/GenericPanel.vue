<script setup lang="ts">
import type { IDockviewPanelProps } from "dockview-vue"
import { RouterView, loadRouteLocation } from "vue-router"

const { params } = defineProps<{
  params: IDockviewPanelProps<{
    routeName: string
    routeParams: Record<string, string>
  }>
}>()

const router = useRouter()

// @ts-expect-error generic usage
const routeLocation = router.resolve({
  name: params.params.routeName,
  params: params.params.routeParams,
})

const { state: staticRoute } = useAsyncState(() => loadRouteLocation(routeLocation), null)
</script>

<template>
  <RouterView v-if="staticRoute" :route="staticRoute">
    <template #default="{ Component }">
      <Suspense>
        <component :is="Component" :params="params.params" />
      </Suspense>
    </template>
  </RouterView>
</template>
