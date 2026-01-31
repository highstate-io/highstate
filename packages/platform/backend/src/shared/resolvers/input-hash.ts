import type { InstanceState } from "../models/project"
import type { ResolvedInstanceInput } from "./input"
import { crc32 } from "@aws-crypto/crc32"
import { type ComponentModel, type InstanceModel, isUnitModel } from "@highstate/contract"
import { encode } from "@msgpack/msgpack"
import { Buffer } from "buffer-polyfill"
import { int32ToBytes } from "../utils"
import { GraphResolver } from "./graph-resolver"

export type InputHashNode = {
  instance: InstanceModel
  component: ComponentModel
  resolvedInputs: Record<string, ResolvedInstanceInput[]>
  state: InstanceState | undefined
  sourceHash: number | undefined
}

export type InputHashOutput = {
  selfHash: number
  inputHash: number
  dependencyOutputHash: number
  outputHash: number
}

/**
 * Resolves the hash of the instance based on its args, resolved input hashes, source hash, and the output hash.
 */
export class InputHashResolver extends GraphResolver<InputHashNode, InputHashOutput> {
  getNodeDependencies({ resolvedInputs }: InputHashNode): string[] {
    const dependencies: string[] = []

    for (const inputs of Object.values(resolvedInputs ?? {})) {
      for (const input of inputs) {
        dependencies.push(input.input.instanceId)
      }
    }

    return dependencies
  }

  processNode({
    instance,
    component,
    resolvedInputs,
    sourceHash,
    state,
  }: InputHashNode): InputHashOutput {
    const selfHashSink: Uint8Array[] = []

    // 0. include the instance id to reflect renames
    selfHashSink.push(Buffer.from(instance.id))

    // 1. include the component definition hash
    selfHashSink.push(int32ToBytes(component.definitionHash))

    // 2. include the input hash nonce if available
    if (state?.inputHashNonce) {
      selfHashSink.push(int32ToBytes(state.inputHashNonce))
    }

    // 3. include instance args encoded as msgpack
    if (instance.args) {
      selfHashSink.push(encode(instance.args))
    }

    // 4. include the source hash if available
    if (sourceHash) {
      selfHashSink.push(int32ToBytes(sourceHash))
    } else if (isUnitModel(component)) {
      this.logger.warn(
        { instanceId: instance.id },
        "missing source hash for unit model, this may lead to incorrect input hash",
      )
    }

    const inputHashSink = [...selfHashSink]

    const sortedInputs = Object.entries(resolvedInputs)
      //
      .sort(([a], [b]) => a.localeCompare(b))

    const dependencyInstanceIds = new Set<string>()

    // 5. include the sorted resolved inputs
    for (const [inputKey, inputs] of sortedInputs) {
      if (Object.keys(inputs).length === 0) {
        continue
      }

      // 5.1. include the input key to distinguish different inputs with possibly the same instanceId
      inputHashSink.push(Buffer.from(inputKey))

      // the instances inside the input should also have stable order
      const instanceIds = inputs.map(input => input.input.instanceId).sort()

      for (const instanceId of instanceIds) {
        const dependency = this.outputs.get(instanceId)
        if (!dependency) {
          this.logger.warn(
            { instanceId, dependentInstanceId: instance.id },
            "missing dependency when calculating input hash, this may lead to incorrect input hash",
          )
          continue
        }

        // 5.2 include both input and output hashes of the dependency
        inputHashSink.push(int32ToBytes(dependency.inputHash))
        inputHashSink.push(int32ToBytes(dependency.outputHash))

        dependencyInstanceIds.add(instanceId)
      }
    }

    // also calculate the dependency output hash as the combined output hashes of all unique dependencies
    const dependencyOutputHashSink: Uint8Array[] = []
    const sortedDependencyInstanceIds = Array.from(dependencyInstanceIds).sort()

    for (const dependencyInstanceId of sortedDependencyInstanceIds) {
      const dependency = this.outputs.get(dependencyInstanceId)
      if (!dependency) {
        this.logger.warn(
          { instanceId: dependencyInstanceId, dependentInstanceId: instance.id },
          "missing dependency when calculating dependency output hash, this may lead to incorrect input hash",
        )
        continue
      }

      dependencyOutputHashSink.push(int32ToBytes(dependency.outputHash))
    }

    return {
      selfHash: crc32(Buffer.concat(selfHashSink)),
      inputHash: crc32(Buffer.concat(inputHashSink)),
      dependencyOutputHash: crc32(Buffer.concat(dependencyOutputHashSink)),
      outputHash: state?.outputHash ?? 0,
    }
  }
}
