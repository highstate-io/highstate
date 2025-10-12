import type { InstanceModel } from "@highstate/contract"
import type { ResolvedInstanceInput } from "../../shared"

export type WorkerData = {
  libraryModulePaths: string[]
  logLevel?: string

  allInstances: InstanceModel[]
  resolvedInputs: Record<string, Record<string, ResolvedInstanceInput[]>>
}
