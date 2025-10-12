import { z } from "zod"
import { objectMetaSchema } from "./meta"
import { fileSchema } from "./pulumi"

/**
 * Contains all the information needed to run a terminal,
 * including the image, command, working directory, environment variables, and files.
 */
export const terminalSpecSchema = z.object({
  /**
   * The Docker image to run the terminal.
   */
  image: z.string(),

  /**
   * The command to run in the terminal.
   */
  command: z.string().array(),

  /**
   * The working directory to run the command in.
   */
  cwd: z.string().optional(),

  /**
   * The environment variables to set in the terminal.
   */
  env: z.record(z.string(), z.string()).optional(),

  /**
   * The files to mount in the terminal.
   *
   * The key is the path where the file will be mounted,
   * and the value is the file content or a reference to an artifact.
   */
  files: z.record(z.string(), fileSchema).optional(),
})

export type TerminalSpec = z.infer<typeof terminalSpecSchema>

/**
 * Terminal schema for unit API.
 */
export const unitTerminalSchema = z.object({
  name: z.string(),
  meta: objectMetaSchema
    .pick({
      title: true,
      globalTitle: true,
      description: true,
      icon: true,
      iconColor: true,
    })
    .required({ title: true }),
  spec: terminalSpecSchema,
})

export type UnitTerminal = z.infer<typeof unitTerminalSchema>
