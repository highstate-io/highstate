import { z } from "@highstate/contract"

/**
 * The schema which represents some generic reference to an implementation of some functionality.
 *
 * The implementation is dynamically loaded from the provided package and can be used to create resources or perform actions.
 *
 * It can be used for:
 *
 * - creating DNS records for different providers;
 * - creating access points for different gateways in different environments;
 * - creating network policies for different CNIs.
 */
export const implementationReferenceSchema = z.object({
  /**
   * The name of the package which contains the implementation.
   */
  package: z.string(),

  /**
   * The implementation specific data.
   */
  data: z.record(z.string(), z.unknown()),
})

export type ImplementationReference = z.infer<typeof implementationReferenceSchema>
