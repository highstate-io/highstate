import {
  type Entity,
  type EntityMeta,
  type EntityValue,
  type EntityValueInput,
  type EntityWithMeta,
  getEntityId,
  HighstateSignature,
  type Secret,
} from "@highstate/contract"
import { type Input, type Output, output, type Unwrap } from "@pulumi/pulumi"
import { type DeepInput, type InputArray, toPromise } from "./utils"

export type MakeEntityOptions<TEntity extends Entity> = {
  entity: TEntity
  identity: string
  meta?: Omit<EntityMeta, "type" | "identity">
  value: Omit<EntityValueInput<TEntity>, "$meta">
}

export function makeEntity<TEntity extends Entity>({
  entity,
  identity,
  meta,
  value,
}: MakeEntityOptions<TEntity>): EntityValue<TEntity> {
  const built = {
    ...(value as Record<string, unknown>),
    $meta: {
      type: entity.type,
      identity,
      ...meta,
    },
  }

  return entity.schema.parse(built) as EntityValue<TEntity>
}

type CommonEntityMeta = Omit<EntityMeta, "type" | "identity">

export type MakeEntityAsyncOptions<TEntity extends Entity> = {
  entity: TEntity
  identity: Input<string>
  meta?: { [K in keyof CommonEntityMeta]?: Input<CommonEntityMeta[K]> }
  value: {
    [K in keyof Omit<EntityValueInput<TEntity>, "$meta">]: DeepInput<EntityValueInput<TEntity>[K]>
  }
}

export function makeSecret<TValue>(value: TValue): Secret<TValue> {
  return {
    [HighstateSignature.Secret]: true,
    value,
  }
}

export function makeSecretOutput<TValue>(value: Input<TValue>): Output<Secret<Unwrap<TValue>>> {
  return output(value).apply(makeSecret)
}

export function makeSecretAsync<TValue>(value: Input<TValue>): Promise<Secret<Unwrap<TValue>>> {
  return toPromise(makeSecretOutput(value)) as Promise<Secret<Unwrap<TValue>>>
}

export function makeEntityOutput<TEntity extends Entity>({
  entity,
  identity,
  meta,
  value,
}: MakeEntityAsyncOptions<TEntity>): Output<EntityValue<TEntity>> {
  return output({
    ...value,
    $meta: {
      type: entity.type,
      identity,
      ...meta,
    },
  }).apply(built => entity.schema.parse(built)) as Output<EntityValue<TEntity>>
}

export function makeEntityAsync<TEntity extends Entity>(
  options: MakeEntityAsyncOptions<TEntity>,
): Promise<EntityValue<TEntity>> {
  return toPromise(makeEntityOutput(options)) as Promise<EntityValue<TEntity>>
}

export type IdentitySource = EntityWithMeta | string

/**
 * Get the combined identity based on the ids of the given entities.
 *
 * This function can be used for entities that do not have their own identity but are defined by the combination of other entities (e.g. a server defined by its network endpoints).
 */
export function getCombinedIdentity(entities: IdentitySource[]): string {
  const sortedIds = entities
    .map(source => (typeof source === "string" ? source : getEntityId(source)))
    .sort() // sort to ensure consistent identity regardless of the order of entities

  return sortedIds.join(":")
}

export function getCombinedIdentityOutput(entities: InputArray<IdentitySource>): Output<string> {
  return output(entities).apply(getCombinedIdentity)
}

export function getCombinedIdentityAsync(entities: IdentitySource[]): Promise<string> {
  return toPromise(getCombinedIdentityOutput(entities))
}
