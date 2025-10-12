import { defineUnit, z } from "@highstate/contract"
import { fileEntity } from "../common/files"

export const ubuntuVersionSchema = z.enum(["22.04", "24.04", "25.04", "25.10"])
export const ubuntuArchitectureSchema = z.enum(["amd64", "arm64"])

/**
 * Ubuntu distribution with image and cloud-config.
 */
export const ubuntu = defineUnit({
  type: "distributions.ubuntu.v1",

  args: {
    version: ubuntuVersionSchema.default("24.04"),
    architecture: ubuntuArchitectureSchema.default("amd64"),
  },

  outputs: {
    image: fileEntity,
    cloudConfig: fileEntity,
  },

  meta: {
    title: "Ubuntu",
    icon: "mdi:ubuntu",
    iconColor: "#E95420",
    category: "Distributions",
  },

  source: {
    package: "@highstate/distributions",
    path: "ubuntu",
  },
})
