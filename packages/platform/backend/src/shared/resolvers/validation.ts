import type { InstanceState } from "../models"
import type { ResolvedInstanceInput } from "./input"
import {
  type ComponentModel,
  type InstanceModel,
  isUnitModel,
  parseArgumentValue,
} from "@highstate/contract"
import { Ajv } from "ajv"
import styles from "ansi-styles"
import { GraphResolver } from "./graph-resolver"

export type ValidationNode = {
  instance: InstanceModel
  component: ComponentModel
  state: InstanceState | undefined
  resolvedInputs: Record<string, ResolvedInstanceInput[]>
}

export type ValidationOutput =
  | {
      status: "ok"
    }
  | {
      status: "error"
      errorText: string
    }

/**
 * Validates the instance based on its arguments and inputs.
 */
export class ValidationResolver extends GraphResolver<ValidationNode, ValidationOutput> {
  getNodeDependencies({ resolvedInputs }: ValidationNode): string[] {
    const dependencies: string[] = []

    for (const inputs of Object.values(resolvedInputs)) {
      for (const input of inputs) {
        dependencies.push(input.input.instanceId)
      }
    }

    return dependencies
  }

  processNode({ instance, component, state, resolvedInputs }: ValidationNode): ValidationOutput {
    const ajv = new Ajv({ strict: false })

    this.logger.debug({ instanceId: instance.id }, "validating instance")

    const validationErrors: string[] = []

    for (const [name, argument] of Object.entries(component.args)) {
      try {
        const value = parseArgumentValue(instance.args?.[name])

        if (!argument.required && value === undefined) {
          continue
        }

        if (!ajv.validate(argument.schema, value)) {
          this.logger.debug({ instanceId: instance.id, argumentName: name }, "invalid argument")

          validationErrors.push(
            `Invalid argument ` +
              `"${styles.blueBright.open}${name}${styles.reset.close}": ` +
              ajv.errorsText(),
          )
        }
      } catch (error) {
        this.logger.debug(
          { instanceId: instance.id, argumentName: name, error },
          "failed to validate argument",
        )

        validationErrors.push(
          `Failed to validate argument ` +
            `"${styles.blueBright.open}${name}${styles.reset.close}": ` +
            (error instanceof Error ? error.message : String(error)),
        )
      }
    }

    if (isUnitModel(component)) {
      for (const [secret, secretSchema] of Object.entries(component.secrets)) {
        if (secretSchema.required && !state?.secretNames?.includes(secret)) {
          validationErrors.push(
            `Missing required secret ` +
              `"${styles.blueBright.open}${secret}${styles.reset.close}"`,
          )
        }
      }
    }

    for (const [key, inputs] of Object.entries(resolvedInputs)) {
      for (const input of inputs) {
        const inputInstance = this.outputs.get(input.input.instanceId)
        if (inputInstance?.status !== "ok") {
          validationErrors.push(
            `Invalid input ` +
              `"${styles.blueBright.open}${key}${styles.reset.close}":\n` +
              `"${styles.blueBright.open}${input.input.instanceId}${styles.reset.close}" ` +
              `has validation errors`,
          )
        }
      }
    }

    for (const [name, input] of Object.entries(component.inputs)) {
      if (!input.required) {
        continue
      }

      if (!resolvedInputs[name] || !resolvedInputs[name].length) {
        validationErrors.push(
          `Missing required input ` +
            `"${styles.blueBright.open}${name}${styles.reset.close}" ` +
            `of type ` +
            `"${styles.greenBright.open}${input.type}${styles.reset.close}"`,
        )
      }
    }

    if (validationErrors.length === 0) {
      return { status: "ok" }
    }

    const numberPrefixLength = (validationErrors.length + 1).toString().length + 2 // +2 for the ". " prefix

    const formattedError = validationErrors
      .map((error, index) => {
        const lines = error.split("\n")
        const prefix = `${index + 1}. `

        return lines
          .map((line, lineIndex) => {
            const linePrefix = lineIndex === 0 ? prefix : " ".repeat(numberPrefixLength)

            return `${linePrefix}${line}`
          })
          .join("\r\n")
      })
      .join("\r\n")

    return {
      status: "error",
      errorText: formattedError,
    }
  }
}
