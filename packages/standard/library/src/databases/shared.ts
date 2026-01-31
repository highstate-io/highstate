import type { Simplify } from "type-fest"
import { $args, $inputs, $secrets, type FullComponentArgumentOptions, z } from "@highstate/contract"
import { mapValues } from "remeda"
import { l4EndpointEntity } from "../network"

export const sharedSchema = z.object({
  /**
   * The username to connect to the database with.
   */
  username: z.string(),

  /**
   * The password to connect to the database with.
   */
  password: z.string().optional(),

  /**
   * The name of the database to connect to.
   */
  database: z.string().optional(),
})

export const sharedArgs = $args({
  /**
   * The endpoints to connect to the database in form of `host:port`.
   */
  endpoints: z.string().array().min(1),

  /**
   * The username to connect to the database with.
   *
   * If not provided, defaults to `root`.
   */
  username: z.string().default("root"),

  /**
   * The name of the database to connect to.
   */
  database: z.string().optional(),
})

type ToOptionalArgs<T extends Record<string, FullComponentArgumentOptions>> = Simplify<{
  [K in keyof T]: Simplify<Omit<T[K], "schema"> & { schema: z.ZodOptional<T[K]["schema"]> }>
}>

export const optionalSharedArgs = mapValues(sharedArgs, arg => ({
  ...arg,
  schema: arg.schema.optional(),
})) as ToOptionalArgs<typeof sharedArgs>

export const sharedSecrets = $secrets({
  /**
   * The password to connect to the database with.
   */
  password: z.string().optional(),
})

export const sharedInputs = $inputs({
  /**
   * The endpoints to connect to the database.
   */
  endpoints: {
    entity: l4EndpointEntity,
    multiple: true,
    required: false,
  },
})
