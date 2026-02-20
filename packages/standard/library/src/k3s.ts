import { defineUnit, z } from "@highstate/contract";
import { clusterInputs, clusterOutputs } from "./k8s/shared";

export const packagedComponents = [
	"coredns",
	"servicelb",
	"traefik",
	"local-storage",
	"metrics-server",
	"runtimes",
] as const;

export const internalComponents = [
	"scheduler",
	"cloud-controller",
	"kube-proxy",
	"network-policy",
	"helm-controller",
] as const;

export const componentSchema = z.enum([
	...packagedComponents,
	...internalComponents,
]);

export const cniSchema = z.enum(["none", "flannel"]);

/**
 * The K3s cluster created on top of the server.
 */
export const cluster = defineUnit({
	type: "k3s.cluster.v1",

	args: {
		/**
		 * The components to disable in the K3S cluster.
		 */
		disabledComponents: componentSchema.array().default([]),

		/**
		 * The CNI to use in the K3S cluster.
		 *
		 * Setting this to "none" will disable default Flannel CNI, but will not disable network policy controller and kube-proxy.
		 * If needed, you can disable them using `disabledComponents` argument.
		 */
		cni: cniSchema.default("flannel"),

		/**
		 * The K3S configuration to pass to each server or agent in the cluster.
		 *
		 * See: https://docs.k3s.io/installation/configuration
		 */
		config: z.record(z.string(), z.unknown()).optional(),

		/**
		 * The K3S configuration to pass to each server in the cluster.
		 *
		 * See: https://docs.k3s.io/installation/configuration
		 */
		serverConfig: z.record(z.string(), z.unknown()).optional(),

		/**
		 * The K3S configuration to pass to each agent in the cluster.
		 *
		 * See: https://docs.k3s.io/installation/configuration
		 */
		agentConfig: z.record(z.string(), z.unknown()).optional(),

		/**
		 * The configuration of the registries to use for the K3S cluster.
		 *
		 * See: https://docs.k3s.io/installation/private-registry
		 */
		registries: z.record(z.string(), z.unknown()).optional(),
	},

	inputs: clusterInputs,
	outputs: clusterOutputs,

	meta: {
		title: "K3s Cluster",
		category: "k3s",
		icon: "devicon:k3s",
		secondaryIcon: "devicon:kubernetes",
	},

	source: {
		package: "@highstate/k3s",
		path: "cluster",
	},
});
