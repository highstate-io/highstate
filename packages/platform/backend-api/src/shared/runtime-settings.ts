import type {
  ContainerRegistryCredentialOutput,
  ContainerRuntimeOutput,
  NpmRegistryCredentialOutput,
  PulumiStateBackendOutput,
} from "@highstate/backend/shared"
import { create } from "@bufbuild/protobuf"
import { timestampFromDate } from "@bufbuild/protobuf/wkt"
import {
  ContainerRegistryCredentialSchema,
  ContainerRuntimeSchema,
  NpmRegistryCredentialSchema,
  PulumiStateBackendSchema,
} from "@highstate/api/v1"

function base(
  value:
    | ContainerRuntimeOutput
    | PulumiStateBackendOutput
    | NpmRegistryCredentialOutput
    | ContainerRegistryCredentialOutput,
) {
  return {
    id: value.id,
    meta: value.meta,
    revision: BigInt(value.revision),
    createdAt: timestampFromDate(value.createdAt),
    updatedAt: timestampFromDate(value.updatedAt),
  }
}

export function toContainerRuntime(value: ContainerRuntimeOutput) {
  const spec = value.spec
  return create(ContainerRuntimeSchema, {
    ...base(value),
    npmRegistryCredentialIds: value.npmRegistryCredentialIds,
    containerRegistryCredentialIds: value.containerRegistryCredentialIds,
    spec: {
      runtimeApiUrl: spec.runtimeApiUrl,
      runtimeApiCaBundle:
        spec.runtimeApiCaBundle === undefined
          ? undefined
          : new TextEncoder().encode(spec.runtimeApiCaBundle),
      imageRepository: spec.imageRepository,
      runtime:
        spec.type === "docker"
          ? {
              case: "docker",
              value: {
                engineEndpoint: spec.engineEndpoint,
                local: spec.local,
                tls: {
                  caBundleConfigured: spec.tls.caBundleConfigured,
                  clientCertificateConfigured: spec.tls.clientCertificateConfigured,
                  clientKeyConfigured: spec.tls.clientKeyConfigured,
                  configured:
                    spec.tls.caBundleConfigured &&
                    spec.tls.clientCertificateConfigured &&
                    spec.tls.clientKeyConfigured,
                },
              },
            }
          : {
              case: "kubernetes",
              value: {
                context: spec.context,
                namespace: spec.namespace,
                serviceAccount: spec.serviceAccount,
                buildkitImage: spec.buildkitImage,
                kubeconfigConfigured: spec.kubeconfigConfigured,
              },
            },
    },
  })
}

export function toPulumiStateBackend(value: PulumiStateBackendOutput) {
  return create(PulumiStateBackendSchema, {
    ...base(value),
    url: value.spec.url,
    credentialsConfigured: value.spec.credentialsConfigured,
  })
}

export function toNpmRegistryCredential(value: NpmRegistryCredentialOutput) {
  return create(NpmRegistryCredentialSchema, {
    ...base(value),
    scope: value.scope,
    registryUrl: value.registryUrl,
    credentialsConfigured: value.credentialsConfigured,
  })
}

export function toContainerRegistryCredential(value: ContainerRegistryCredentialOutput) {
  return create(ContainerRegistryCredentialSchema, {
    ...base(value),
    registryUrl: value.registryUrl,
    credentialsConfigured: value.credentialsConfigured,
  })
}
