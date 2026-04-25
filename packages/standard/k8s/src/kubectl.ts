import type { k8s } from "@highstate/library"
import type { InputOrArray } from "@highstate/pulumi"
import type { Namespace } from "./namespace"
import type { Workload } from "./workload"
import { Command, MaterializedFile } from "@highstate/common"
import {
  ComponentResource,
  type ComponentResourceOptions,
  type Input,
  type Output,
  output,
} from "@pulumi/pulumi"
import { images } from "./shared"

export type KubeCommandArgs = {
  /**
   * The kubernetes cluster to run the command against.
   */
  cluster: Input<k8s.Cluster>

  /**
   * The namespace to run the command in, if any.
   */
  namespace?: Input<string>

  /**
   * The create command to run.
   */
  create: InputOrArray<string>

  /**
   * The update command to run.
   */
  update?: InputOrArray<string>

  /**
   * The delete command to run.
   */
  delete?: InputOrArray<string>
}

export type NamespaceKubeCommandArgs = Omit<KubeCommandArgs, "cluster" | "namespace"> & {
  /**
   * The namespace to run the command in.
   */
  namespace: Input<Namespace>
}

export type ExecKubeCommandArgs = Omit<KubeCommandArgs, "cluster" | "namespace"> & {
  /**
   * The workload to exec into.
   */
  workload: Input<Workload>
}

function createCommand(command: string | string[]): string {
  if (Array.isArray(command)) {
    return command.join(" ")
  }

  return command
}

function buildKubeCommand(
  command: InputOrArray<string>,
  namespace?: Input<string>,
): Output<string> {
  if (namespace) {
    return output([command, namespace]).apply(
      ([cmd, ns]) => `kubectl -n ${ns} ${createCommand(cmd)}`,
    )
  }

  return output(command).apply(cmd => `kubectl ${createCommand(cmd)}`)
}

function buildWorkloadExecCommand(
  command: InputOrArray<string>,
  workload: Input<Workload>,
): Output<string> {
  return output({
    command,
    kind: output(workload).kind,
    name: output(workload).metadata.name,
  }).apply(({ command, kind, name }) => {
    const type = kind.toLowerCase()

    return `exec -it ${type}/${name} -- ${createCommand(command)}`
  })
}

export class KubeCommand extends ComponentResource {
  /**
   * The underlying command that will be executed when this unit is invoked.
   */
  readonly command: Output<Command>

  /**
   * The standard output of the command.
   */
  readonly stdout: Output<string>

  /**
   * The standard error of the command.
   */
  readonly stderr: Output<string>

  constructor(name: string, args: KubeCommandArgs, opts?: ComponentResourceOptions) {
    super("highstate:k8s:KubeCommand", name, args, opts)

    this.command = output(args.cluster).apply(cluster => {
      const kubeconfig = MaterializedFile.for(cluster.kubeconfig)

      return new Command(`kubectl-${name}`, {
        host: "local",
        create: buildKubeCommand(args.create, args.namespace),
        update: args.update ? buildKubeCommand(args.update, args.namespace) : undefined,
        delete: args.delete ? buildKubeCommand(args.delete, args.namespace) : undefined,
        files: [kubeconfig],
        image: images["terminal-kubectl"].image,
        containerShell: "bash",
        environment: {
          KUBECONFIG: kubeconfig.path,
        },
      })
    })

    this.stdout = this.command.stdout
    this.stderr = this.command.stderr
  }

  static forNamespace(
    name: string,
    args: NamespaceKubeCommandArgs,
    opts?: ComponentResourceOptions,
  ): KubeCommand {
    return new KubeCommand(
      name,
      {
        cluster: output(args.namespace).cluster,
        create: args.create,
        update: args.update,
        delete: args.delete,
        namespace: output(args.namespace).metadata.name,
      },
      opts,
    )
  }

  static execInto(
    name: string,
    args: ExecKubeCommandArgs,
    opts?: ComponentResourceOptions,
  ): KubeCommand {
    return KubeCommand.forNamespace(
      name,
      {
        namespace: output(args.workload).namespace,
        create: buildWorkloadExecCommand(args.create, args.workload),
        update: args.update ? buildWorkloadExecCommand(args.update, args.workload) : undefined,
        delete: args.delete ? buildWorkloadExecCommand(args.delete, args.workload) : undefined,
      },
      opts,
    )
  }
}
