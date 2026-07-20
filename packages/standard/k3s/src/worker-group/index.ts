import { k3s } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"
import { createK3sWorker } from "../shared"

const { args, inputs, outputs } = forUnit(k3s.workerGroup)

const { cluster, workers } = await toPromise(inputs)

for (const worker of workers) {
  createK3sWorker({
    server: worker,
    bootstrapEndpoint: cluster.bootstrapEndpoint,
    agentToken: cluster.agentToken.value,
    agentConfig: cluster.agentConfig,
    registries: cluster.registries,
    config: args.config,
    nodeConfig: args.nodeConfig,
  })
}

export default outputs({ workers })
