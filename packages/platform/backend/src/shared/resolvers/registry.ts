import type { Logger } from "pino"
import type { DependentSetHandler, GraphResolver, ResolverOutputHandler } from "./graph-resolver"
import { InputResolver, type InputResolverNode, type InputResolverOutput } from "./input"
import { type InputHashNode, type InputHashOutput, InputHashResolver } from "./input-hash"
import { type ValidationNode, type ValidationOutput, ValidationResolver } from "./validation"

export type GraphResolverType = keyof GraphResolverMap

export type GraphResolverMap = {
  InputResolver: [InputResolverNode, InputResolverOutput]
  InputHashResolver: [InputHashNode, InputHashOutput]
  ValidationResolver: [ValidationNode, ValidationOutput]
}

export const resolverFactories = {
  InputResolver,
  InputHashResolver,
  ValidationResolver,
} as Record<
  GraphResolverType,
  new (
    nodes: ReadonlyMap<string, unknown>,
    logger: Logger,
    outputHandler?: ResolverOutputHandler<unknown>,
    dependentSetHandler?: DependentSetHandler,
  ) => GraphResolver<unknown, unknown>
>
