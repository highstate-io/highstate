import type { k8s } from "@highstate/library"
import type { ResourceTransform } from "@pulumi/pulumi"

function applySchedulingToPodSpec(
  spec: Record<string, unknown> | undefined,
  scheduling: k8s.Scheduling,
): Record<string, unknown> {
  return {
    ...spec,
    ...scheduling,
  }
}

/**
 * Creates a resource transform that applies scheduling options to Kubernetes pod specs.
 *
 * @param scheduling The scheduling options to apply.
 * @returns A transform for Kubernetes resources that own pods.
 */
export function createSchedulingTransform(scheduling: k8s.Scheduling): ResourceTransform {
  return args => {
    if (args.type === "kubernetes:core/v1:Pod") {
      return {
        props: {
          ...args.props,
          spec: applySchedulingToPodSpec(args.props.spec, scheduling),
        },
        opts: args.opts,
      }
    }

    if (
      args.type === "kubernetes:apps/v1:Deployment" ||
      args.type === "kubernetes:apps/v1:StatefulSet" ||
      args.type === "kubernetes:apps/v1:DaemonSet" ||
      args.type === "kubernetes:batch/v1:Job"
    ) {
      return {
        props: {
          ...args.props,
          spec: {
            ...args.props.spec,
            template: {
              ...args.props.spec?.template,
              spec: applySchedulingToPodSpec(args.props.spec?.template?.spec, scheduling),
            },
          },
        },
        opts: args.opts,
      }
    }

    if (args.type === "kubernetes:batch/v1:CronJob") {
      const jobTemplate = args.props.spec?.jobTemplate
      const template = jobTemplate?.spec?.template

      return {
        props: {
          ...args.props,
          spec: {
            ...args.props.spec,
            jobTemplate: {
              ...jobTemplate,
              spec: {
                ...jobTemplate?.spec,
                template: {
                  ...template,
                  spec: applySchedulingToPodSpec(template?.spec, scheduling),
                },
              },
            },
          },
        },
        opts: args.opts,
      }
    }

    return undefined
  }
}
