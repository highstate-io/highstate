import { defineUnit } from "@highstate/contract"
import { deobfuscatorSpec, obfuscatorSpec } from "./shared"

/**
 * The Phantun Deobfuscator deployed on Kubernetes.
 */
export const deobfuscator = defineUnit({
  type: "k8s.obfuscators.phantun.deobfuscator.v1",
  ...deobfuscatorSpec,

  meta: {
    title: "Phantun Deobfuscator",
    icon: "mdi:network-outline",
    secondaryIcon: "mdi:hide",
    category: "Obfuscators",
  },

  source: {
    package: "@highstate/k8s.obfuscators",
    path: "phantun/deobfuscator",
  },
})

/**
 * The Phantun Obfuscator deployed on Kubernetes.
 */
export const obfuscator = defineUnit({
  type: "k8s.obfuscators.phantun.obfuscator.v1",
  ...obfuscatorSpec,

  meta: {
    title: "Phantun Obfuscator",
    icon: "mdi:network-outline",
    secondaryIcon: "mdi:hide",
    category: "Obfuscators",
  },

  source: {
    package: "@highstate/k8s.obfuscators",
    path: "phantun/obfuscator",
  },
})
