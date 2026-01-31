import type { common, network, ssh } from "@highstate/library"
import { stripNullish, type UnitTerminal } from "@highstate/contract"
import {
  fileFromString,
  type Input,
  type Output,
  output,
  secret,
  toPromise,
} from "@highstate/pulumi"
import { remote } from "@pulumi/command"
import getKeys, { PrivateExport } from "micro-key-producer/ssh.js"
import { randomBytes } from "micro-key-producer/utils.js"
import * as images from "../../assets/images.json"
import { Command } from "./command"
import { l3EndpointToL4, l3EndpointToString } from "./network/endpoints"

export async function createSshTerminal(
  credentials: Input<ssh.Connection>,
): Promise<Output<UnitTerminal>> {
  const resolvedCredentials = await toPromise(credentials)

  const command = ["ssh", "-tt", "-o", "UserKnownHostsFile=/known_hosts"]

  // TODO: select best endpoint based on the environment
  const endpoint = resolvedCredentials.endpoints[0]

  command.push("-p", endpoint.port.toString())

  if (resolvedCredentials.keyPair) {
    command.push("-i", "/private_key")
  }

  command.push(`${resolvedCredentials.user}@${l3EndpointToString(endpoint)}`)

  if (resolvedCredentials.password) {
    command.unshift("sshpass", "-f", "/password")
  }

  return output({
    name: "ssh",

    meta: {
      title: "Shell",
      description: "Connect to the server via SSH.",
      icon: "gg:remote",
    },

    spec: {
      image: images["terminal-ssh"].image,
      command,

      files: stripNullish({
        "/password": resolvedCredentials.password
          ? fileFromString("password", resolvedCredentials.password, { isSecret: true })
          : undefined,

        "/private_key": resolvedCredentials.keyPair?.privateKey
          ? fileFromString("private_key", resolvedCredentials.keyPair.privateKey, {
              isSecret: true,
              mode: 0o600,
            })
          : undefined,

        "/known_hosts": fileFromString(
          "known_hosts",
          `${l3EndpointToString(endpoint)} ${resolvedCredentials.hostKey}`,
          { mode: 0o644 },
        ),
      }),
    },
  })
}

/**
 * Creates a file containing the SSH host key(s) of all endpoints of the given server.
 *
 * @param server The server entity to create the host key file for.
 * @returns An Output of the created file entity.
 */
export function createSshHostKeyFile(server: Input<common.Server>): Output<common.File> {
  return output(server).apply(server => {
    if (!server.ssh) {
      throw new Error("Server must have an SSH endpoint defined to create a host key file")
    }

    return fileFromString(
      `${server.hostname}-ssh-host-key`,
      server.ssh.endpoints.map(ep => `${l3EndpointToString(ep)} ${server.ssh!.hostKey}`).join("\n"),
      { mode: 0o644 },
    )
  })
}

/**
 * Generates a secure random SSH private key.
 * The key is generated using the Ed25519 algorithm.
 *
 * @returns The generated SSH private key in PEM format.
 */
export function generateSshPrivateKey(): Output<string> {
  const seed = randomBytes(32)

  return secret(getKeys(seed).privateKey)
}

/**
 * Converts a private SSH key string to a KeyPair object.
 *
 * @param privateKeyString The private key string to convert.
 * @returns An Output of the KeyPair object.
 */
export function sshPrivateKeyToKeyPair(privateKeyString: Input<string>): Output<ssh.KeyPair> {
  return output(privateKeyString).apply(privateKeyString => {
    const privateKeyStruct = PrivateExport.decode(privateKeyString)

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const privKey = privateKeyStruct.keys[0].privKey.privKey as Uint8Array

    const { fingerprint, publicKey } = getKeys(privKey.slice(0, 32))

    return output({
      type: "ed25519" as const,
      fingerprint,
      publicKey,
      privateKey: secret(privateKeyString),
    })
  })
}

export type ServerOptions = {
  /**
   * The local name of the server to namespace resources.
   */
  name: string

  /**
   * The fallback hostname to use if the server cannot be determined.
   *
   * If not provided, the `name` will be used as the fallback hostname.
   */
  fallbackHostname?: string

  /**
   * The L3 endpoints of the server.
   */
  endpoints: network.L3Endpoint[]

  /**
   * The arguments for the SSH connection.
   */
  sshArgs?: Partial<ssh.Args>

  /**
   * The password for the SSH connection.
   */
  sshPassword?: Input<string>

  /**
   * The private key for the SSH connection.
   */
  sshPrivateKey?: Input<string>

  /**
   * The SSH key pair for the server.
   * If provided, it will take precedence over the `sshPrivateKey` argument.
   */
  sshKeyPair?: Input<ssh.KeyPair>

  /**
   * Whether to wait for the server to respond to a ping command before returning.
   *
   * If true, the command will wait for a successful ping response before proceeding.
   *
   * By default, this is equal to `!waitForSsh`, so when `waitForSsh` is true, no extra ping is performed.
   */
  waitForPing?: boolean

  /**
   * The interval in seconds to wait between ping attempts.
   *
   * Only used if `waitForPing` is true.
   * By default, it will wait 5 seconds between attempts.
   */
  pingInterval?: number

  /**
   * The timeout in seconds to wait for the server to respond to a ping command.
   *
   * Only used if `waitForPing` is true.
   * By default, it will wait 5 minutes (300 seconds) before timing out.
   */
  pingTimeout?: number

  /**
   * Whether to wait for the SSH service to be available before returning.
   *
   * If true, the command will wait for the SSH service to respond before proceeding.
   *
   * By default, this is true if `sshArgs.enabled` is true, otherwise false.
   */
  waitForSsh?: boolean

  /**
   * The interval in seconds to wait between SSH connection attempts.
   *
   * Only used if `waitForSsh` is true.
   * By default, it will wait 5 seconds between attempts.
   */
  sshCheckInterval?: number

  /**
   * The timeout in seconds to wait for the SSH service to respond.
   *
   * Only used if `waitForSsh` is true.
   * By default, it will wait 5 minutes (300 seconds) before timing out.
   */
  sshCheckTimeout?: number
}

export type ServerBundle = {
  /**
   * The server entity created with the provided options.
   */
  server: Output<common.Server>

  /**
   * The SSH terminal created for the server.
   */
  terminal?: Output<UnitTerminal>
}

/**
 * Creates a server entity with the provided options and returns a bundle containing the server entity and terminal.
 *
 * Basically, it just a convenience function that calls `createServerEntity` and `createSshTerminal`.
 *
 * @param options The options for creating the server entity.
 * @returns A promise that resolves to a ServerBundle containing the server entity and terminal.
 */
export async function createServerBundle(options: ServerOptions): Promise<ServerBundle> {
  const server = await createServerEntity(options)
  const ssh = await toPromise(server.ssh)

  return {
    server,
    terminal: ssh ? await createSshTerminal(ssh) : undefined,
  }
}

/**
 * Creates a server entity with the provided options.
 * It will create a command to check the SSH service and return the server entity.
 *
 * @param options The options for creating the server entity.
 * @returns A promise that resolves to the created server entity.
 */
export async function createServerEntity({
  name,
  fallbackHostname,
  endpoints,
  sshArgs = { enabled: true, port: 22, user: "root" },
  sshPassword,
  sshPrivateKey,
  sshKeyPair,
  pingInterval,
  pingTimeout,
  waitForPing,
  waitForSsh,
  sshCheckInterval,
  sshCheckTimeout,
}: ServerOptions): Promise<Output<common.Server>> {
  if (endpoints.length === 0) {
    throw new Error("At least one L3 endpoint is required to create a server entity")
  }

  fallbackHostname ??= name
  waitForSsh ??= sshArgs.enabled
  waitForPing ??= !waitForSsh

  if (waitForPing) {
    await Command.waitFor(`${name}.ping`, {
      host: "local",
      create: `ping -c 1 ${l3EndpointToString(endpoints[0])}`,
      timeout: pingTimeout ?? 300,
      interval: pingInterval ?? 5,
      triggers: [Date.now()],
    }).wait()
  }

  if (!sshArgs.enabled) {
    return output({
      hostname: name,
      endpoints,
    })
  }

  const sshHost = sshArgs?.host ?? l3EndpointToString(endpoints[0])

  if (waitForSsh) {
    await Command.waitFor(`${name}.ssh`, {
      host: "local",
      create: `nc -zv ${sshHost} ${sshArgs.port}`,
      timeout: sshCheckTimeout ?? 300,
      interval: sshCheckInterval ?? 5,
      triggers: [Date.now()],
    }).wait()
  }

  const connection = output({
    host: sshHost,
    port: sshArgs.port,
    user: sshArgs.user,
    password: sshPassword,
    privateKey: sshKeyPair ? output(sshKeyPair).privateKey : sshPrivateKey,
    dialErrorLimit: 3,
  })

  const hostnameResult = new remote.Command("hostname", {
    connection,
    create: "hostname",
    triggers: [Date.now()],
  })

  const hostKeyResult = new remote.Command("host-key", {
    connection,
    create: "cat /etc/ssh/ssh_host_ed25519_key.pub",
    triggers: [Date.now()],
  })

  return output({
    endpoints,
    hostname: hostnameResult.stdout.apply(x => x.trim()),
    ssh: {
      endpoints: [l3EndpointToL4(sshHost, sshArgs.port ?? 22)],
      user: sshArgs.user ?? "root",
      hostKey: hostKeyResult.stdout.apply(x => x.trim()),
      password: connection.password,
      keyPair: sshKeyPair
        ? sshKeyPair
        : sshPrivateKey
          ? sshPrivateKeyToKeyPair(sshPrivateKey)
          : undefined,
    },
  })
}
