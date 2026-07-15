import { parseAllDocuments, stringify } from "yaml"

const helmResourceProcessorFeatures = ["remove-gateway-api-crds", "strip-helm-hooks"] as const
const gatewayApiCrdSuffixes = [".gateway.networking.k8s.io", ".gateway.networking.x-k8s.io"]

export type HelmResourceProcessorFeature = (typeof helmResourceProcessorFeatures)[number]

type KubernetesManifest = {
  kind?: unknown
  metadata?: {
    name?: unknown
    annotations?: Record<string, unknown>
  }
}

const features = parseFeatures(Bun.argv.slice(2))
const input = await Bun.stdin.text()
const documents = parseAllDocuments(input)

for (const document of documents) {
  if (document.errors.length > 0) {
    throw new Error("Failed to parse Helm manifest", { cause: document.errors[0] })
  }
}

const renderedDocuments = documents.flatMap(document => {
  const manifest = document.toJSON() as KubernetesManifest | null
  if (!manifest || shouldRemoveManifest(manifest, features)) {
    return []
  }

  processManifest(manifest, features)

  return stringify(manifest)
})

process.stdout.write(renderedDocuments.join("---\n"))

function parseFeatures(features: string[]): Set<HelmResourceProcessorFeature> {
  const knownFeatures = new Set<string>(helmResourceProcessorFeatures)
  const unknownFeature = features.find(feature => !knownFeatures.has(feature))

  if (unknownFeature) {
    throw new Error(`Unknown Helm resource processor feature: ${unknownFeature}`)
  }

  return new Set(features as HelmResourceProcessorFeature[])
}

function shouldRemoveManifest(
  manifest: KubernetesManifest,
  features: Set<HelmResourceProcessorFeature>,
): boolean {
  return features.has("remove-gateway-api-crds") && isGatewayApiCrd(manifest)
}

function processManifest(
  manifest: KubernetesManifest,
  features: Set<HelmResourceProcessorFeature>,
): void {
  if (features.has("strip-helm-hooks")) {
    stripHelmHookAnnotations(manifest)
  }
}

function isGatewayApiCrd(manifest: KubernetesManifest): boolean {
  const name = manifest.metadata?.name
  if (manifest.kind !== "CustomResourceDefinition" || typeof name !== "string") {
    return false
  }

  return gatewayApiCrdSuffixes.some(suffix => name.endsWith(suffix))
}

function stripHelmHookAnnotations(manifest: KubernetesManifest): void {
  const annotations = manifest.metadata?.annotations
  if (!annotations) {
    return
  }

  for (const key of Object.keys(annotations)) {
    if (key.startsWith("helm.sh/hook")) {
      delete annotations[key]
    }
  }
}
