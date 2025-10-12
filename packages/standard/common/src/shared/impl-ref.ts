import type { z } from "@highstate/contract"
import type { ImplementationReference } from "@highstate/library"
import { type Input, type Output, output, toPromise, type Unwrap } from "@highstate/pulumi"

/**
 * The ImplementationMediator is used as a contract between the calling code and the implementation.
 *
 * From the calling code perspective, it provides a way to define the input and output schemas for the implementation
 * and call the implementation with the provided input.
 *
 * From the implementation perspective, it provides a way to get zod function with automatic type inference and validation.
 */
export class ImplementationMediator<
  TInputSchema extends z.ZodType,
  TOutputSchema extends z.ZodType,
> {
  constructor(
    readonly path: string,
    private readonly inputSchema: TInputSchema,
    private readonly outputSchema: TOutputSchema,
  ) {}

  implement<TDataSchema extends z.ZodType>(
    dataSchema: TDataSchema,
    func: (
      input: z.infer<TInputSchema>,
      data: z.infer<TDataSchema>,
    ) => z.infer<TOutputSchema> | Promise<z.infer<TOutputSchema>>,
  ) {
    return async (
      input: z.infer<TInputSchema>,
      data: z.infer<TDataSchema>,
    ): Promise<z.infer<TOutputSchema>> => {
      const parsedInput = this.inputSchema.safeParse(input)
      if (!parsedInput.success) {
        throw new Error(
          `Invalid input for implementation "${this.path}": ${parsedInput.error.message}`,
        )
      }

      const parsedData = dataSchema.safeParse(data)
      if (!parsedData.success) {
        throw new Error(
          `Invalid data for implementation "${this.path}": ${parsedData.error.message}`,
        )
      }

      const result = await func(parsedInput.data, parsedData.data)
      const parsedResult = this.outputSchema.safeParse(result)

      if (!parsedResult.success) {
        throw new Error(
          `Invalid output from implementation "${this.path}": ${parsedResult.error.message}`,
        )
      }

      return parsedResult.data
    }
  }

  async call(
    implRef: Input<ImplementationReference>,
    input: Input<z.infer<TInputSchema>>,
  ): Promise<z.infer<TOutputSchema>> {
    const resolvedImplRef = await toPromise(implRef)
    const resolvedInput = await toPromise(input)

    const importPath = `${resolvedImplRef.package}/impl/${this.path}`

    let impl: Record<string, unknown>
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      impl = await import(importPath)
    } catch (error) {
      throw new Error(`Failed to import module "${importPath}" required by implementation.`, {
        cause: error,
      })
    }

    const funcs = Object.entries(impl).filter(value => typeof value[1] === "function") as [
      string,
      (...args: unknown[]) => unknown,
    ][]

    if (funcs.length === 0) {
      throw new Error(`No implementation functions found in module "${importPath}".`)
    }

    if (funcs.length > 1) {
      throw new Error(
        `Multiple implementation functions found in module "${importPath}": ${funcs.map(func => func[0]).join(", ")}. ` +
          "Ensure only one function is exported.",
      )
    }

    const [funcName, implFunc] = funcs[0]

    let result: unknown
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      result = await implFunc(resolvedInput, resolvedImplRef.data)
    } catch (error) {
      console.error(`Error in implementation function "${funcName}":`, error)
      throw new Error(`Implementation function "${funcName}" failed`)
    }

    const parsedResult = this.outputSchema.safeParse(result)
    if (!parsedResult.success) {
      throw new Error(
        `Implementation function "${funcName}" returned invalid result: ${parsedResult.error.message}`,
      )
    }

    return parsedResult.data
  }

  callOutput(
    implRef: Input<ImplementationReference>,
    input: Input<z.infer<TInputSchema>>,
  ): Output<Unwrap<z.infer<TOutputSchema>>> {
    return output(this.call(implRef, input))
  }
}
