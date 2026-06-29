import type {
  InstanceId,
  RuntimeSidecarReadiness,
  RuntimeSidecarStartInput,
  RuntimeSidecarStartOutput,
} from "@highstate/contract"
import type { Logger } from "pino"
import { randomUUID } from "node:crypto"
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { connect } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import spawn, { type Subprocess, SubprocessError } from "nano-spawn"

export type SidecarTrackerOptions = {
  dockerBinary: string
  dockerUseSudo: boolean
  dockerHost?: string
  logger: Logger
  onUnitLog: (unitId: InstanceId, message: string) => void
}

type OperationSidecars = {
  operationId: string
  refCount: number
  cleanupOnRelease: boolean
  tempPath: string
  hostsFilePath: string
  hosts: Map<string, string>
  sidecars: Map<string, SidecarState>
}

type SidecarState = {
  id: string
  identity: string
  specKey: string
  host: string
  ip: string
  containerName: string
  consumers: Set<InstanceId>
  output?: Promise<RuntimeSidecarStartOutput>
  logProcess?: Subprocess
  stdoutBuffer: string
  stderrBuffer: string
}

type DockerResult = {
  stdout: string
  stderr: string
}

const endpointSuffix = ".highstate.local"
const identityPattern = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/
const sidecarPrefixOpen = "\x1b[1;35m"
const sidecarPrefixClose = "\x1b[0m"

export class SidecarTracker {
  private readonly operations = new Map<string, OperationSidecars>()
  private readonly allocatedIps = new Set<string>()
  private nextIpOffset = 1

  constructor(private readonly options: SidecarTrackerOptions) {}

  async registerExecution(operationId: string, cleanupOnRelease: boolean): Promise<string> {
    const operation = await this.getOrCreateOperation(operationId)
    operation.cleanupOnRelease ||= cleanupOnRelease
    operation.refCount++

    return operation.hostsFilePath
  }

  async releaseExecution(operationId: string, unitId: InstanceId): Promise<void> {
    const operation = this.operations.get(operationId)
    if (!operation) {
      return
    }

    for (const sidecar of operation.sidecars.values()) {
      sidecar.consumers.delete(unitId)
    }

    operation.refCount--
    if (operation.refCount > 0 || !operation.cleanupOnRelease) {
      return
    }

    await this.cleanupOperation(operation)
  }

  async finishOperation(operationId: string): Promise<void> {
    const operation = this.operations.get(operationId)
    if (!operation) {
      return
    }

    await this.cleanupOperation(operation)
  }

  async startSidecar(
    operationId: string,
    unitId: InstanceId,
    input: RuntimeSidecarStartInput,
  ): Promise<RuntimeSidecarStartOutput> {
    if (!identityPattern.test(input.identity)) {
      throw new Error(`Invalid sidecar identity "${input.identity}"`)
    }

    const operation = await this.getOrCreateOperation(operationId)
    const specKey = JSON.stringify(input)
    const existing = operation.sidecars.get(input.identity)
    if (existing) {
      if (existing.specKey !== specKey) {
        throw new Error(`Sidecar "${input.identity}" already exists with different configuration`)
      }

      existing.consumers.add(unitId)
      this.emitUnitLifecycleLog(unitId, existing.identity, `reusing sidecar`)

      if (!existing.output) {
        throw new Error(`Sidecar "${input.identity}" exists without startup state`)
      }

      return await existing.output
    }

    const id = randomUUID()
    const host = `${input.identity}${endpointSuffix}`
    const ip = this.allocateIp()
    const containerName = `highstate-sidecar-${id}`
    operation.hosts.set(host, ip)

    const sidecar: SidecarState = {
      id,
      identity: input.identity,
      specKey,
      host,
      ip,
      containerName,
      consumers: new Set([unitId]),
      stdoutBuffer: "",
      stderrBuffer: "",
    }

    this.emitUnitLifecycleLog(unitId, input.identity, `starting sidecar`)
    sidecar.output = this.startNewSidecar(operation, input, sidecar)

    operation.sidecars.set(input.identity, sidecar)
    await this.writeHostsFile(operation)

    try {
      if (!sidecar.output) {
        throw new Error(`Sidecar "${input.identity}" did not start`)
      }

      return await sidecar.output
    } catch (error) {
      this.emitSidecarLog(sidecar, `failed to start sidecar: ${this.errorToString(error)}`)
      this.options.logger.warn(
        { error, operationId: operation.operationId, identity: input.identity },
        "failed to start sidecar",
      )

      operation.hosts.delete(host)
      operation.sidecars.delete(input.identity)
      this.allocatedIps.delete(ip)
      await this.writeHostsFile(operation)
      await this.stopContainer(containerName)

      throw new Error(`Failed to start sidecar "${input.identity}". See unit sidecar logs.`)
    }
  }

  private async getOrCreateOperation(operationId: string): Promise<OperationSidecars> {
    const existing = this.operations.get(operationId)
    if (existing) {
      return existing
    }

    const tempPath = resolve(tmpdir(), "highstate", "sidecars", operationId)
    await mkdir(tempPath, { recursive: true })

    const operation: OperationSidecars = {
      operationId,
      refCount: 0,
      cleanupOnRelease: false,
      tempPath,
      hostsFilePath: join(tempPath, "hosts"),
      hosts: new Map(),
      sidecars: new Map(),
    }

    this.operations.set(operationId, operation)
    await this.writeHostsFile(operation)

    return operation
  }

  private async startNewSidecar(
    operation: OperationSidecars,
    input: RuntimeSidecarStartInput,
    sidecar: SidecarState,
  ): Promise<RuntimeSidecarStartOutput> {
    const args = ["run", "-d", "--rm", "--network", "host", "--name", sidecar.containerName]
    const env = {
      ...input.env,
      HIGHSTATE_SIDECAR_ID: sidecar.id,
      HIGHSTATE_SIDECAR_HOST: sidecar.host,
      HIGHSTATE_SIDECAR_IP: sidecar.ip,
    }

    for (const [key, value] of Object.entries(env)) {
      args.push("-e", `${key}=${value}`)
    }

    const filesPath = join(operation.tempPath, input.identity, "files")
    for (const file of input.files) {
      const filePath = join(filesPath, file.path.replace(/^\/+/, ""))
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, file.content, { mode: file.mode ?? 0o600 })
      await chmod(filePath, file.mode ?? 0o600)
      args.push("-v", `${filePath}:${file.path}:ro`)
    }

    args.push(input.image)
    if (input.command) {
      args.push(...input.command)
    }
    args.push(...input.args)

    const result = await this.runDocker(args)
    const containerId = result.stdout.trim()
    if (!containerId) {
      throw new Error(`Failed to start sidecar "${input.identity}" without container ID`)
    }

    await this.startLogStream(operation, input, sidecar)
    await this.waitUntilReady(input.identity, sidecar, input.ports, input.readiness)

    this.options.logger.info(
      { operationId: operation.operationId, sidecarId: sidecar.id, identity: input.identity },
      "sidecar started",
    )

    return {
      id: sidecar.id,
      host: sidecar.host,
      ports: Object.fromEntries(
        input.ports.map(port => [
          port.name,
          {
            host: sidecar.host,
            port: port.containerPort,
          },
        ]),
      ),
    }
  }

  private async waitUntilReady(
    identity: string,
    sidecar: Pick<SidecarState, "ip" | "containerName">,
    ports: RuntimeSidecarStartInput["ports"],
    readiness: RuntimeSidecarReadiness | undefined,
  ): Promise<void> {
    if (!readiness) {
      return
    }

    const deadline = Date.now() + readiness.timeoutSeconds * 1000

    while (Date.now() < deadline) {
      if (await this.isReady(sidecar, ports, readiness)) {
        return
      }

      await new Promise(resolve => setTimeout(resolve, 500))
    }

    throw new Error(`Timed out waiting for sidecar "${identity}" to become ready`)
  }

  private async startLogStream(
    operation: OperationSidecars,
    input: RuntimeSidecarStartInput,
    sidecar: SidecarState,
  ): Promise<void> {
    const args = ["logs", "-f", sidecar.containerName]
    sidecar.logProcess = this.createDockerProcess(args)

    sidecar.logProcess.catch(error => {
      if (error instanceof SubprocessError && error.signalName === "SIGTERM") {
        this.options.logger.info(
          { operationId: operation.operationId, identity: input.identity },
          "sidecar log stream stopped",
        )
        return
      }

      this.options.logger.warn(
        { error, operationId: operation.operationId, identity: input.identity },
        "sidecar log stream failed",
      )
    })

    const nodeProcess = await sidecar.logProcess.nodeChildProcess

    nodeProcess.stdout?.on("data", (chunk: Buffer) => {
      sidecar.stdoutBuffer = this.processLogChunk(sidecar, sidecar.stdoutBuffer, chunk)
    })

    nodeProcess.stderr?.on("data", (chunk: Buffer) => {
      sidecar.stderrBuffer = this.processLogChunk(sidecar, sidecar.stderrBuffer, chunk)
    })

    nodeProcess.once("close", (code, signal) => {
      this.flushLogBuffer(sidecar, "stdoutBuffer")
      this.flushLogBuffer(sidecar, "stderrBuffer")

      this.options.logger.info(
        { operationId: operation.operationId, identity: input.identity, code, signal },
        "sidecar log stream closed",
      )
    })
  }

  private processLogChunk(sidecar: SidecarState, buffer: string, chunk: Buffer): string {
    const text = buffer + chunk.toString()
    const lines = text.split("\n")
    const nextBuffer = lines.pop() ?? ""

    for (const line of lines) {
      if (line.trim()) {
        this.emitSidecarLog(sidecar, line)
      }
    }

    return nextBuffer
  }

  private flushLogBuffer(sidecar: SidecarState, field: "stdoutBuffer" | "stderrBuffer"): void {
    const line = sidecar[field]
    if (line.trim()) {
      this.emitSidecarLog(sidecar, line)
    }

    sidecar[field] = ""
  }

  private emitSidecarLog(sidecar: SidecarState, message: string): void {
    for (const unitId of sidecar.consumers) {
      this.emitUnitLifecycleLog(unitId, sidecar.identity, message)
    }
  }

  private emitUnitLifecycleLog(unitId: InstanceId, identity: string, message: string): void {
    this.options.onUnitLog(unitId, this.formatSidecarLog(identity, message))
  }

  private formatSidecarLog(identity: string, message: string): string {
    return `${sidecarPrefixOpen}[sidecar] [${identity}]${sidecarPrefixClose} ${message}`
  }

  private errorToString(error: unknown): string {
    if (error instanceof Error) {
      return error.message
    }

    return String(error)
  }

  private async isReady(
    sidecar: Pick<SidecarState, "ip" | "containerName">,
    ports: RuntimeSidecarStartInput["ports"],
    readiness: RuntimeSidecarReadiness,
  ): Promise<boolean> {
    switch (readiness.type) {
      case "tcp":
        return await this.isTcpReady(sidecar.ip, this.getReadinessPort(ports, readiness.port))

      case "http":
        return await this.isHttpReady(
          sidecar.ip,
          this.getReadinessPort(ports, readiness.port),
          readiness.path,
          readiness.statuses,
        )

      case "log": {
        const result = await this.runDocker(["logs", sidecar.containerName])
        return result.output.includes(readiness.pattern)
      }
    }
  }

  private getReadinessPort(ports: RuntimeSidecarStartInput["ports"], name: string): number {
    const port = ports.find(port => port.name === name)
    if (!port) {
      throw new Error(`Readiness port "${name}" is not defined`)
    }

    return port.containerPort
  }

  private async isTcpReady(host: string, port: number): Promise<boolean> {
    return await new Promise(resolve => {
      const socket = connect({ host, port })
      socket.once("connect", () => {
        socket.destroy()
        resolve(true)
      })
      socket.once("error", () => resolve(false))
      socket.setTimeout(500, () => {
        socket.destroy()
        resolve(false)
      })
    })
  }

  private async isHttpReady(
    host: string,
    port: number,
    path: string,
    statuses: number[],
  ): Promise<boolean> {
    try {
      const response = await fetch(`http://${host}:${port}${path}`)
      return statuses.includes(response.status)
    } catch {
      return false
    }
  }

  private allocateIp(): string {
    for (let i = 0; i < 65_534; i++) {
      const offset = this.nextIpOffset
      this.nextIpOffset = this.nextIpOffset === 65_534 ? 1 : this.nextIpOffset + 1
      const ip = `127.72.${Math.floor(offset / 256)}.${offset % 256}`

      if (!this.allocatedIps.has(ip)) {
        this.allocatedIps.add(ip)
        return ip
      }
    }

    throw new Error(`No local sidecar endpoint IPs available`)
  }

  private async writeHostsFile(operation: OperationSidecars): Promise<void> {
    const baseHosts = await readFile("/etc/hosts", "utf-8").catch(() => "127.0.0.1 localhost\n")
    const sidecarHosts = Array.from(operation.hosts, ([host, ip]) => `${ip} ${host}`).join("\n")
    const content =
      sidecarHosts.length > 0 ? `${baseHosts.trimEnd()}\n${sidecarHosts}\n` : baseHosts

    await writeFile(operation.hostsFilePath, content)
  }

  private async cleanupOperation(operation: OperationSidecars): Promise<void> {
    this.operations.delete(operation.operationId)

    await Promise.allSettled(
      Array.from(operation.sidecars.values()).map(sidecar => this.stopSidecar(operation, sidecar)),
    )

    for (const sidecar of operation.sidecars.values()) {
      this.allocatedIps.delete(sidecar.ip)
    }

    await rm(operation.tempPath, { recursive: true, force: true })
  }

  private async stopSidecar(operation: OperationSidecars, sidecar: SidecarState): Promise<void> {
    this.options.logger.info(
      { operationId: operation.operationId, identity: sidecar.identity },
      "stopping sidecar container",
    )

    await this.stopContainer(sidecar.containerName)
    sidecar.logProcess?.nodeChildProcess
      .then(process => process.kill())
      .catch(error => {
        this.options.logger.warn(
          { error, operationId: operation.operationId, identity: sidecar.identity },
          "failed to stop sidecar log process",
        )
      })
  }

  private async stopContainer(containerName: string): Promise<void> {
    await this.runDocker(["rm", "-f", containerName]).catch(error => {
      this.options.logger.warn({ error, containerName }, "failed to stop sidecar container")
    })
  }

  private async runDocker(args: string[]): Promise<DockerResult & { output: string }> {
    const result = await this.createDockerProcess(args)

    return result
  }

  private createDockerProcess(args: string[]): Subprocess {
    const command = this.options.dockerUseSudo ? "sudo" : this.options.dockerBinary
    const finalArgs = this.options.dockerUseSudo ? [this.options.dockerBinary, ...args] : args

    return spawn(command, finalArgs, {
      env: {
        DOCKER_HOST: this.options.dockerHost,
      },
    })
  }
}
