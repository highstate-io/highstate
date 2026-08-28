import type { ComponentModel, InstanceModel } from "@highstate/contract"
import type { ResolvedInstanceInput } from "../../shared"

export type WorkerData = {
  libraryModulePaths: string[]
  virtualComponents: Record<string, ComponentModel>
  logLevel?: string

  allInstances: InstanceModel[]
  resolvedInputs: Record<string, Record<string, ResolvedInstanceInput[]>>
}
