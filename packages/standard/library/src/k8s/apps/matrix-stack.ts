import { defineUnit, text, z } from "@highstate/contract"
import { pick } from "remeda"
import { l4EndpointEntity } from "../../network"
import { serviceEntity } from "../service"
import { appName, sharedInputs, source } from "./shared"

/**
 * The Matrix stack deployed on Kubernetes.
 */
export const matrixStack = defineUnit({
  type: "k8s.apps.matrix-stack.v1",

  args: {
    ...appName("matrix-stack"),

    /**
     * The Matrix server name used in user and room IDs.
     */
    serverName: {
      schema: z.string(),
      meta: {
        description: text`
          The Matrix server name used for user and room identifiers.
          This value cannot be changed after the first deployment.
        `,
      },
    },

    /**
     * The Synapse ingress hostname.
     */
    synapseHost: {
      schema: z.string().optional(),
      meta: {
        description: text`
          The hostname for the Synapse ingress.
          Defaults to "synapse.<serverName>".
        `,
      },
    },

    /**
     * The Element Web ingress hostname.
     */
    elementWebHost: {
      schema: z.string().optional(),
      meta: {
        description: text`
          The hostname for the Element Web ingress.
          Defaults to "element.<serverName>".
        `,
      },
    },

    /**
     * The Element Admin ingress hostname.
     */
    elementAdminHost: {
      schema: z.string().optional(),
      meta: {
        description: text`
          The hostname for the Element Admin ingress.
          Defaults to "admin.<serverName>".
        `,
      },
    },

    /**
     * The Matrix Authentication Service ingress hostname.
     */
    matrixAuthenticationServiceHost: {
      schema: z.string().optional(),
      meta: {
        description: text`
          The hostname for the Matrix Authentication Service ingress.
          Defaults to "mas.<serverName>".
        `,
      },
    },

    /**
     * The Matrix RTC ingress hostname.
     */
    matrixRtcHost: {
      schema: z.string().optional(),
      meta: {
        description: text`
          The hostname for the Matrix RTC ingress.
          Defaults to "mrtc.<serverName>".
        `,
      },
    },

    /**
     * The ingress class to use for all Matrix stack ingresses.
     */
    ingressClassName: {
      schema: z.string().optional(),
      meta: {
        description: text`The ingress class name to apply to all ingresses.`,
      },
    },

    /**
     * The TLS secret to use for all Matrix stack ingresses.
     */
    ingressTlsSecret: {
      schema: z.string().optional(),
      meta: {
        description: text`The TLS secret name to apply to all ingresses.`,
      },
    },

    /**
     * The annotations to apply to all Matrix stack ingresses.
     */
    ingressAnnotations: {
      schema: z.record(z.string(), z.string()).optional(),
      meta: {
        description: text`The ingress annotations to apply to all ingresses.`,
      },
    },
  },

  inputs: {
    ...pick(sharedInputs, ["k8sCluster"]),
  },

  outputs: {
    service: serviceEntity,
    endpoints: {
      entity: l4EndpointEntity,
      multiple: true,
    },
  },

  meta: {
    title: "Matrix Stack",
    icon: "simple-icons:matrixdotorg",
    secondaryIcon: "simple-icons:element",
    category: "Communication",
  },

  source: source("matrix-stack"),
})
