import type {
  HubInput,
  HubModel,
  HubModelPatch,
  InstanceId,
  InstanceInput,
  InstanceModel,
  InstanceModelPatch,
} from "@highstate/contract"

/**
 * Deletes all references to an instance from other instances' inputs.
 *
 * @param inputs The inputs record to clean up.
 * @param instanceId The instance ID to remove references to.
 */
export function deleteInstanceReferences(
  inputs: Record<string, InstanceInput[]>,
  instanceId: string,
): void {
  for (const [inputKey, input] of Object.entries(inputs)) {
    inputs[inputKey] = input.filter(inputItem => inputItem.instanceId !== instanceId)

    if (inputs[inputKey].length === 0) {
      delete inputs[inputKey]
    }
  }
}

/**
 * Deletes all references to a hub from instance hub inputs.
 *
 * @param inputs The hub inputs record to clean up.
 * @param hubId The hub ID to remove references to.
 */
export function deleteHubReferences(inputs: Record<string, HubInput[]>, hubId: string): void {
  for (const [inputKey, input] of Object.entries(inputs)) {
    inputs[inputKey] = input.filter(inputItem => inputItem.hubId !== hubId)

    if (inputs[inputKey].length === 0) {
      delete inputs[inputKey]
    }
  }
}

/**
 * Updates all references to an instance with a new instance ID.
 *
 * @param inputs The inputs array to update.
 * @param oldInstanceId The old instance ID to replace.
 * @param newInstanceId The new instance ID to use.
 */
export function renameInstanceReferences(
  inputs: InstanceInput[],
  oldInstanceId: string,
  newInstanceId: InstanceId,
): void {
  for (const input of inputs) {
    if (input.instanceId === oldInstanceId) {
      input.instanceId = newInstanceId
    }
  }
}

/**
 * Removes all references to a deleted instance from instances and hubs.
 *
 * @param instances The instances to clean up.
 * @param hubs The hubs to clean up.
 * @param instanceId The instance ID to remove references to.
 */
export function cleanupInstanceReferences(
  instances: Iterable<InstanceModel>,
  hubs: Iterable<HubModel>,
  instanceId: string,
): void {
  // delete all inputs of instances that reference deleted instance
  for (const otherInstance of instances) {
    if (!otherInstance.inputs) {
      continue
    }

    deleteInstanceReferences(otherInstance.inputs, instanceId)

    if (Object.keys(otherInstance.inputs).length === 0) {
      delete otherInstance.inputs
    }
  }

  // delete all inputs of hubs that reference deleted instance
  for (const hub of hubs) {
    if (!hub.inputs) {
      continue
    }

    hub.inputs = hub.inputs.filter(input => input.instanceId !== instanceId)

    if (hub.inputs.length === 0) {
      delete hub.inputs
    }
  }
}

/**
 * Removes all references to a deleted hub from instances and hubs.
 *
 * @param instances The instances to clean up.
 * @param hubs The hubs to clean up.
 * @param hubId The hub ID to remove references to.
 */
export function cleanupHubReferences(
  instances: Iterable<InstanceModel>,
  hubs: Iterable<HubModel>,
  hubId: string,
): void {
  // delete all inputs of instances that reference deleted hub
  for (const instance of instances) {
    if (instance.hubInputs) {
      deleteHubReferences(instance.hubInputs, hubId)

      if (Object.keys(instance.hubInputs).length === 0) {
        delete instance.hubInputs
      }
    }

    if (instance.injectionInputs) {
      instance.injectionInputs = instance.injectionInputs.filter(input => input.hubId !== hubId)

      if (instance.injectionInputs.length === 0) {
        delete instance.injectionInputs
      }
    }
  }

  // delete all inputs of hubs that reference deleted hub
  for (const otherHub of hubs) {
    if (!otherHub.injectionInputs) {
      continue
    }

    otherHub.injectionInputs = otherHub.injectionInputs.filter(input => input.hubId !== hubId)

    if (otherHub.injectionInputs.length === 0) {
      delete otherHub.injectionInputs
    }
  }
}

/**
 * Updates all references to a renamed instance in instances and hubs.
 *
 * @param instances The instances to update.
 * @param hubs The hubs to update.
 * @param oldInstanceId The old instance ID to replace.
 * @param newInstanceId The new instance ID to use.
 */
export function updateInstanceReferences(
  instances: Iterable<InstanceModel>,
  hubs: Iterable<HubModel>,
  oldInstanceId: string,
  newInstanceId: InstanceId,
): void {
  // update all references to the instance from other instances
  for (const otherInstance of instances) {
    for (const inputs of Object.values(otherInstance.inputs ?? {})) {
      renameInstanceReferences(inputs, oldInstanceId, newInstanceId)
    }
  }

  // update all references to the instance from hubs
  for (const hub of hubs) {
    renameInstanceReferences(hub.inputs ?? [], oldInstanceId, newInstanceId)
  }
}

/**
 * Applies a patch to an instance model.
 *
 * @param instance The instance to patch.
 * @param patch The patch to apply.
 */
export function applyInstancePatch(instance: InstanceModel, patch: InstanceModelPatch): void {
  if (patch.args) {
    instance.args = patch.args
  }

  if (patch.position) {
    instance.position = patch.position
  }

  if (patch.inputs) {
    if (Object.keys(patch.inputs).length > 0) {
      instance.inputs = patch.inputs
    } else {
      delete instance.inputs
    }
  }

  if (patch.hubInputs) {
    if (Object.keys(patch.hubInputs).length > 0) {
      instance.hubInputs = patch.hubInputs
    } else {
      delete instance.hubInputs
    }
  }

  if (patch.injectionInputs) {
    if (patch.injectionInputs.length > 0) {
      instance.injectionInputs = patch.injectionInputs
    } else {
      delete instance.injectionInputs
    }
  }
}

/**
 * Applies a patch to a hub model.
 *
 * @param hub The hub to patch.
 * @param patch The patch to apply.
 */
export function applyHubPatch(hub: HubModel, patch: HubModelPatch): void {
  if (patch.position) {
    hub.position = patch.position
  }

  if (patch.inputs) {
    if (patch.inputs.length > 0) {
      hub.inputs = patch.inputs
    } else {
      delete hub.inputs
    }
  }

  if (patch.injectionInputs) {
    if (patch.injectionInputs.length > 0) {
      hub.injectionInputs = patch.injectionInputs
    } else {
      delete hub.injectionInputs
    }
  }
}
