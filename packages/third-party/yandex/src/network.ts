import { parseEndpoint, parseSubnet } from "@highstate/common"
import { network, type yandex } from "@highstate/library"
import { getCombinedIdentity, interpolate, makeEntity, toPromise } from "@highstate/pulumi"
import {
  type GetVpcNetworkResult,
  getVpcNetwork,
  getVpcSubnet,
  type Provider,
} from "@highstate/yandex-sdk"

export type NetworkContext = {
  networkId: string
  vpcNetwork: GetVpcNetworkResult
  allSubnets: network.Subnet[]
}

export type InstanceNetworkInterface = {
  ipAddress?: string | null
  natIpAddress?: string | null
}

export type InstanceWithNetworkInterfaces = {
  networkInterfaces?: InstanceNetworkInterface[] | null
}

export async function detectSubnetId(
  subnetId: string | undefined,
  connection: yandex.Connection,
  provider: Provider,
): Promise<string> {
  if (subnetId) {
    return subnetId
  }

  const defaultSubnetName = await toPromise(interpolate`default-${connection.defaultZone}`)
  const subnet = await getVpcSubnet(
    {
      folderId: await toPromise(connection.defaultFolderId),
      name: defaultSubnetName,
    },
    { provider },
  )

  if (!subnet.id) {
    throw new Error(
      `Could not find default subnet '${defaultSubnetName}' in zone ${connection.defaultZone}`,
    )
  }

  return subnet.id
}

export async function fetchNetworkContext(
  subnetId: string,
  provider: Provider,
): Promise<NetworkContext> {
  const subnet = await getVpcSubnet({ subnetId }, { provider })
  const networkId = await toPromise(subnet.networkId)

  const vpcNetwork = await getVpcNetwork({ networkId }, { provider })
  const allVpcSubnets = await Promise.all(
    vpcNetwork.subnetIds.map(subnetId => getVpcSubnet({ subnetId }, { provider })),
  )

  const allSubnets = allVpcSubnets
    .flatMap(vpcSubnet => [...vpcSubnet.v4CidrBlocks, ...vpcSubnet.v6CidrBlocks])
    .map(parseSubnet)

  return {
    networkId,
    vpcNetwork,
    allSubnets,
  }
}

const sharedMeta = {
  icon: "simple-icons:yandexcloud",
  iconColor: "#0080ff",
}

export function buildEndpointWithNetwork(
  ipAddress: string,
  networkContext: NetworkContext,
): network.L3Endpoint {
  const baseEndpoint = parseEndpoint(ipAddress, 3)

  return {
    ...baseEndpoint,
    network: makeEntity({
      entity: network.networkEntity,
      identity: getCombinedIdentity(["yandex", networkContext.networkId]),
      meta: {
        title: `${networkContext.vpcNetwork.name}`,
        description: `ID: ${networkContext.networkId} | ${networkContext.vpcNetwork.description}`,
        ...sharedMeta,
      },
      value: {
        subnets: networkContext.allSubnets.map(subnet => ({
          ...subnet,
          $meta: {
            ...subnet.$meta,
            ...sharedMeta,
          },
        })),
      },
    }),
  }
}

export function buildEndpointsFromInstance(
  instance: InstanceWithNetworkInterfaces,
  assignPublicIp: boolean,
  networkContext: NetworkContext,
): network.L3Endpoint[] {
  const firstInterface = instance.networkInterfaces?.[0]

  const privateIp = firstInterface?.ipAddress
  if (!privateIp) {
    throw new Error("No private IP address assigned to instance")
  }

  const privateEndpoint = buildEndpointWithNetwork(privateIp, networkContext)

  if (assignPublicIp) {
    const publicIp = firstInterface?.natIpAddress
    if (!publicIp) {
      throw new Error("No public IP address assigned to instance")
    }

    return [parseEndpoint(publicIp, 3), privateEndpoint]
  }

  return [privateEndpoint]
}
