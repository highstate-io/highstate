import type { WorkerServiceImplementation } from "@highstate/api/worker.v1"
import type { Services } from "@highstate/backend"
import { commonObjectMetaSchema, serviceAccountMetaSchema, z } from "@highstate/contract"
import { authenticate, parseArgument } from "../shared"

const workerMetaUpdatePayloadSchema = z.union([
  commonObjectMetaSchema,
  z.object({
    workerMeta: commonObjectMetaSchema,
    serviceAccountMeta: serviceAccountMetaSchema,
  }),
])

export function createWorkerService(services: Services): WorkerServiceImplementation {
  return {
    async *connect(request, context) {
      const [projectId, apiKey] = await authenticate(services, context)

      const workerVersionId = parseArgument(request, "workerVersionId", z.cuid2())
      const workerInstanceId = parseArgument(request, "workerInstanceId", z.cuid2())
      const dataEndpoint = parseArgument(request, "dataEndpoint", z.string().min(1))
      const database = await services.database.forProject(projectId)
      const workerVersion = await database.workerVersion.findFirst({
        where: { id: workerVersionId, apiKeyId: apiKey.id },
        select: { id: true },
      })
      if (!workerVersion) {
        throw new Error(`Worker version "${workerVersionId}" is not owned by the API key`)
      }

      services.workerManager.assertWorkerInstance(projectId, workerVersionId, workerInstanceId)
      services.panelEndpointManager.connect(
        projectId,
        workerVersionId,
        workerInstanceId,
        dataEndpoint,
      )

      try {
        await services.workerManager.setWorkerRunning(projectId, workerVersionId, workerInstanceId)
        const existingRegistrations = await database.workerUnitRegistration.findMany({
          where: { workerVersionId },
          select: { stateId: true, params: true },
        })
        for (const registration of existingRegistrations) {
          yield {
            event: {
              $case: "unitRegistration",
              value: {
                stateId: registration.stateId,
                params: registration.params,
              },
            },
          }
        }
        const registrationStream = await services.pubsubManager.subscribe([
          "worker-unit-registration",
          projectId,
          workerVersionId,
        ])
        for await (const event of registrationStream) {
          if (event.type === "registered") {
            yield {
              event: {
                $case: "unitRegistration",
                value: { stateId: event.stateId, params: event.params },
              },
            }
          } else if (event.type === "deregistered") {
            yield {
              event: {
                $case: "unitDeregistration",
                value: { stateId: event.stateId },
              },
            }
          }
        }
      } finally {
        services.panelEndpointManager.disconnect(workerInstanceId)
      }
    },

    async updateWorkerVersionMeta(request, context) {
      const [projectId] = await authenticate(services, context)

      const workerVersionId = parseArgument(request, "workerVersionId", z.string())
      const payload = parseArgument(request, "meta", workerMetaUpdatePayloadSchema)

      const workerMeta = "workerMeta" in payload ? payload.workerMeta : payload
      const serviceAccountMeta =
        "serviceAccountMeta" in payload ? payload.serviceAccountMeta : undefined

      await services.workerService.updateWorkerVersionMeta(
        projectId,
        workerVersionId,
        workerMeta,
        serviceAccountMeta,
      )

      return {}
    },
  }
}
