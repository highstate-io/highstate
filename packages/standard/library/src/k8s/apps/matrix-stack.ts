import { defineUnit, z } from "@highstate/contract"
import { pick } from "remeda"
import { postgresql } from "../../databases"
import { appName, sharedInputs, source } from "./shared"

/**
 * The Matrix stack deployed on Kubernetes.
 */
export const matrixStack = defineUnit({
  type: "k8s.apps.matrix-stack.v1",

  args: {
    ...appName("matrix-stack"),

    /**
     * The base domain for the Matrix stack services.
     *
     * Subdomains for Matrix services are generated automatically.
     * This value cannot be changed after the first deployment.
     */
    fqdn: z.string(),

    /**
     * Whether to enable cinny web client deployment.
     *
     * The FQDN will be generated as `cinny.${fqdn}`.
     */
    enableCinny: z.boolean().default(false),

    /**
     * The list of remote Matrix domains that are allowed for federation.
     *
     * Leave empty to allow federation with all domains.
     */
    federationDomainWhitelist: z.array(z.string()).default([]),
  },

  inputs: {
    ...pick(sharedInputs, ["k8sCluster", "accessPoint"]),

    /**
     * The PostgreSQL connection for the Synapse server.
     */
    synapsePostgresql: postgresql.connectionEntity,

    /**
     * The PostgreSQL connection for the Matrix Authentication Service.
     */
    masPostgresql: postgresql.connectionEntity,
  },

  secrets: {},

  meta: {
    title: "Matrix Stack",
    icon: "simple-icons:matrix",
    secondaryIcon: "simple-icons:element",
    category: "Communication",
  },

  source: source("matrix-stack"),
})
