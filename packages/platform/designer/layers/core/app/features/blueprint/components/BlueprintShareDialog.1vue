<script setup lang="ts">
import { useVueFlow, VueFlow } from "@vue-flow/core"
import { Background } from "@vue-flow/background"
import { createBlueprint, type Blueprint } from "../business"
import type { HubModel, InstanceModel } from "@highstate/contract"
import type { GraphNode } from "@vue-flow/core"

/**
 * Configuration for blueprint sharing
 */
interface ShareConfig {
  displayName: string
  description: string
  selfContained: boolean
  hideInstanceNames: boolean
}

const visible = defineModel<boolean>("visible")

const { selectedNodes } = defineProps<{
  selectedNodes: GraphNode[]
}>()

// Form state
const shareConfig = reactive<ShareConfig>({
  displayName: "",
  description: "",
  selfContained: true,
  hideInstanceNames: false,
})

const generatedLink = ref<string>()
const isLoading = ref(false)

// Extract instances and hubs from selected nodes
const { instances, hubs } = computed(() => {
  const instances: InstanceModel[] = []
  const hubs: HubModel[] = []

  for (const node of selectedNodes) {
    if (node.data.instance) {
      instances.push(node.data.instance)
    } else if (node.data.hub) {
      hubs.push(node.data.hub)
    }
  }

  return { instances, hubs }
}).value

// Create blueprint for preview
const blueprint = computed(() => {
  if (!selectedNodes.length) return null

  return createBlueprint(
    selectedNodes,
    instances,
    hubs,
    libraryStore.library,
    shareConfig.selfContained,
  )
})

// Process blueprint for sharing (hide names if requested)
const processedBlueprint = computed(() => {
  if (!blueprint.value) return null

  if (!shareConfig.hideInstanceNames) {
    return blueprint.value
  }

  // Create a copy with instance names hidden
  return {
    ...blueprint.value,
    instances: blueprint.value.instances.map((instance, index) => ({
      ...instance,
      name: `Instance ${index + 1}`,
    })),
  }
})

// Mock encryption and link generation functions
// TODO: Implement actual encryption using Web Crypto API
const encryptBlueprint = async (
  blueprint: Blueprint,
  metadata: Partial<ShareConfig>,
): Promise<string> => {
  // Generate a random encryption key
  const key = crypto.getRandomValues(new Uint8Array(32))

  // Combine blueprint with metadata
  const data = {
    blueprint,
    metadata: {
      displayName: metadata.title,
      description: metadata.description,
      createdAt: new Date().toISOString(),
    },
  }

  // TODO: Implement actual AES-GCM encryption
  const encryptedData = btoa(JSON.stringify(data))
  const keyHex = Array.from(key)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")

  return `${encryptedData}:${keyHex}`
}

const generateShareableLink = async (encryptedData: string): Promise<string> => {
  // TODO: Replace with actual share service endpoint
  const baseUrl = window.location.origin
  return `${baseUrl}/share/blueprint#${encryptedData}`
}

const shareBlueprint = async () => {
  if (!processedBlueprint.value) return

  isLoading.value = true

  try {
    // Encrypt the blueprint with metadata
    const encryptedData = await encryptBlueprint(processedBlueprint.value, shareConfig)

    // Generate shareable link
    const link = await generateShareableLink(encryptedData)

    generatedLink.value = link
  } catch (error) {
    globalLogger.error({ error }, "Failed to generate shareable link")
    // TODO: Show error notification
  } finally {
    isLoading.value = false
  }
}

const copyLink = () => {
  if (generatedLink.value) {
    copy(generatedLink.value)
  }
}

const copyIconText = computed(() => (copied.value ? "mdi-check" : "mdi-content-copy"))

// Initialize display name with a default
watch(
  () => selectedNodes.length,
  nodeCount => {
    if (nodeCount > 0 && !shareConfig.title) {
      shareConfig.title = `Blueprint with ${nodeCount} node${nodeCount !== 1 ? "s" : ""}`
    }
  },
  { immediate: true },
)

// Preview flow store setup
const previewFlowStore = useVueFlow("blueprint-preview")

// Set up preview nodes when blueprint changes
watch(
  blueprint,
  newBlueprint => {
    if (!newBlueprint || !showPreview.value) return

    // Clear existing nodes
    previewFlowStore.removeNodes(previewFlowStore.getNodes.value.map(n => n.id))

    // Add blueprint nodes for preview
    for (let i = 0; i < newBlueprint.instances.length; i++) {
      const instance = newBlueprint.instances[i]
      previewFlowStore.addNodes({
        id: `preview-instance-${i}`,
        type: "instance",
        position: instance.position || { x: 0, y: 0 },
        data: { instance },
        connectable: false,
        deletable: false,
        selectable: false,
      })
    }

    for (let i = 0; i < newBlueprint.hubs.length; i++) {
      const hub = newBlueprint.hubs[i]
      previewFlowStore.addNodes({
        id: `preview-hub-${i}`,
        type: "hub",
        position: hub.position,
        data: { hub },
        connectable: false,
        deletable: false,
        selectable: false,
      })
    }
  },
  { immediate: true },
)

const closeDialog = () => {
  visible.value = false
  generatedLink.value = undefined
}
</script>

<template>
  <VDialog v-model="visible" width="80vw" height="80vh" scrollable>
    <VCard title="Share Blueprint" color="#2d2d2d" style="height: 100%">
      <VCardText style="height: 100%">
        <VRow style="height: 100%">
          <!-- Configuration Column -->
          <VCol cols="12" md="3" class="d-flex flex-column">
            <div class="flex-grow-1">
              <!-- Blueprint Info Section -->
              <p class="text-body-2 text-medium-emphasis mb-4">
                Generate a shareable link for your blueprint. Only people with the link can access
                the blueprint.
              </p>

              <div class="text-overline mb-2">Metadata</div>

              <!-- Display Name & Description -->
              <div class="mb-4">
                <VTextField
                  v-model="shareConfig.title"
                  label="Display Name"
                  variant="outlined"
                  density="compact"
                  class="mb-3"
                  hint="A friendly name for your blueprint (optional)"
                  persistent-hint
                />

                <VTextarea
                  v-model="shareConfig.description"
                  label="Description"
                  variant="outlined"
                  density="compact"
                  rows="3"
                  hint="Describe what this blueprint does (optional)"
                  persistent-hint
                />
              </div>

              <VDivider class="mb-4" />

              <!-- Options -->
              <div class="text-overline mb-2">Options</div>

              <div class="mb-4">
                <VCheckbox
                  v-model="shareConfig.selfContained"
                  label="Self-contained blueprint"
                  density="compact"
                  hide-details
                  class="mb-2"
                >
                  <template #append>
                    <VTooltip location="top">
                      <template #activator="{ props }">
                        <VIcon v-bind="props" size="small" class="ml-2">
                          mdi-help-circle-outline
                        </VIcon>
                      </template>
                      Includes all component and entity definitions in the blueprint. Recommended
                      for sharing with others who might not have the same library.
                    </VTooltip>
                  </template>
                </VCheckbox>

                <VCheckbox
                  v-model="shareConfig.hideInstanceNames"
                  label="Hide instance names"
                  density="compact"
                  hide-details
                >
                  <template #append>
                    <VTooltip location="top">
                      <template #activator="{ props }">
                        <VIcon v-bind="props" size="small" class="ml-2">
                          mdi-help-circle-outline
                        </VIcon>
                      </template>
                      Replaces instance names with generic names like "Instance 1", "Instance 2".
                      Useful for sharing templates without revealing internal naming.
                    </VTooltip>
                  </template>
                </VCheckbox>
              </div>

              <VDivider class="mb-4" />

              <div class="text-overline mb-2">Sharing Server</div>

              <!-- Server Information -->
              <div class="d-flex align-center mb-4">
                <VIcon class="mr-2" :size="32">mdi-server</VIcon>
                <div class="d-flex flex-column">
                  <span class="text-body-2 font-weight-medium">Highstate Europe</span>
                  <span class="text-caption text-medium-emphasis">highstate.io</span>
                </div>
              </div>

              <!-- Privacy Information -->
              <p class="text-body-2 text-medium-emphasis mb-4">
                <strong>Privacy:</strong>
                Your blueprint is encrypted locally before uploading and the decryption key is
                embedded in the link after the # symbol.

                <br />

                The server

                <a href="https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Fragment">
                  <span>has no way</span>
                </a>

                to access this key and cannot decrypt the blueprint.

                <br />

                The metadata is also encrypted.

                <br />
                <br />

                <strong class="text-warning">Note:</strong>
                The blueprint will be deleted after 30 days of no access.
              </p>

              <!-- Generated Link Section -->
              <div class="d-flex align-center">
                <VTextField
                  model-value=""
                  placeholder="highstate.io/share/xxxxxxxx#xxxxxxxxxxxx"
                  variant="outlined"
                  density="compact"
                  readonly
                  class="flex-grow-1 mr-3"
                  hide-details
                />

                <VBtn color="primary" style="min-width: 0; height: 39px" @click="copyLink">
                  <!-- <VIcon>mdi-content-copy</VIcon> -->
                  <VIcon class="mr-2">mdi-share-variant</VIcon>
                  Share
                </VBtn>
              </div>
            </div>

            <VBtn variant="text" @click="closeDialog">Close</VBtn>
          </VCol>

          <!-- Preview Column -->
          <VCol cols="12" md="9">
            <VCard variant="outlined" class="preview-container" style="height: 100%">
              <div class="preview-flow">
                <VueFlow
                  id="blueprint-preview"
                  :min-zoom="0.1"
                  :max-zoom="1"
                  :zoom-on-scroll="false"
                  :zoom-on-pinch="false"
                  :zoom-on-double-click="false"
                  :pan-on-scroll="false"
                  :selection-key-code="null"
                  :multi-selection-key-code="null"
                  :delete-key-code="null"
                  fit-view-on-init
                >
                  <Background pattern-color="#666" />

                  <template #node-instance="props">
                    <div class="preview-node instance-node">
                      <VIcon>mdi-cube-outline</VIcon>
                      <div class="node-label">{{ props.data.instance.name }}</div>
                    </div>
                  </template>

                  <template #node-hub>
                    <div class="preview-node hub-node">
                      <VIcon>mdi-router</VIcon>
                    </div>
                  </template>
                </VueFlow>
              </div>
            </VCard>
          </VCol>
        </VRow>
      </VCardText>
    </VCard>
  </VDialog>
</template>

<style scoped>
.preview-container {
  position: relative;
  overflow: hidden;
}

.preview-flow {
  width: 100%;
  height: 100%;
}

.preview-node {
  background: #2d2d2d;
  border: 1px solid #555;
  border-radius: 4px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 80px;
  min-height: 60px;
}

.instance-node {
  background: #1976d2;
}

.hub-node {
  background: #424242;
}

.node-label {
  font-size: 10px;
  margin-top: 4px;
  text-align: center;
  color: white;
}

.preview-placeholder {
  border: 1px dashed #555;
  border-radius: 4px;
}
</style>
