<script setup lang="ts">
import type { IDockviewPanelProps } from "dockview-vue"
import { loadRouteLocation, RouterView } from "vue-router"
import { routeAccess } from "../../../utils/access-policy"

const { params } = defineProps<{
  params: IDockviewPanelProps<{
    routeName: string
    routeParams: Record<string, string>
  }>
}>()

const router = useRouter()

const routeLocation = router.resolve({
  name: params.params.routeName,
  params: params.params.routeParams,
})

const { state: staticRoute } = useAsyncState(() => loadRouteLocation(routeLocation), null)
</script>

<template>
  <RouterView v-if="staticRoute" :route="staticRoute">
    <template #default="{ Component }">
      <Suspense v-if="params.params.routeName.startsWith('settings.')">
        <component :is="Component" :params="params.params" />
      </Suspense>
      <AccessBoundary
        v-else
        panel
        :requirements="routeAccess(params.params.routeName, params.params.routeParams)"
      >
        <Suspense>
          <component :is="Component" :params="params.params" />
        </Suspense>
      </AccessBoundary>
    </template>
  </RouterView>
</template>
