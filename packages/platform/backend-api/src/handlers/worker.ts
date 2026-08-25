import type { ServiceImpl } from "@connectrpc/connect"
import type { Services } from "@highstate/backend"
import { create } from "@bufbuild/protobuf"
import { ConnectResponseSchema, type WorkerService } from "@highstate/api/worker.v1"
import { WorkerOwnershipError } from "@highstate/backend/shared"
import { commonObjectMetaSchema, serviceAccountMetaSchema, z } from "@highstate/contract"
import { authenticateProject, parseArgument, toJsonObject } from "../shared"

export function createWorkerService(services: Services): ServiceImpl<typeof WorkerService> {
  return {
    async *connect(request, context) {
      const requestContext = await authenticateProject(services, request, context)
      const { projectId } = requestContext

      const workerVersionId = parseArgument(request, "workerVersionId", z.cuid2())
      const workerInstanceId = parseArgument(request, "workerInstanceId", z.cuid2())
      const dataEndpoint = parseArgument(request, "dataEndpoint", z.string().min(1))
      const database = await services.database.forProject(projectId)
      const workerVersion = await database.workerVersion.findFirst({
        where: { id: workerVersionId, apiKeyId: requestContext.subject.apiKeyId },
        select: { id: true },
      })
      if (!workerVersion) {
        throw new WorkerOwnershipError(projectId, workerVersionId)
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
          yield create(ConnectResponseSchema, {
            event: {
              case: "unitRegistration",
              value: {
                stateId: registration.stateId,
                params: toJsonObject(registration.params),
              },
            },
          })
        }
        const registrationStream = await services.pubsubManager.subscribe([
          "worker-unit-registration",
          projectId,
          workerVersionId,
        ])
        for await (const event of registrationStream) {
          if (event.type === "registered") {
            yield create(ConnectResponseSchema, {
              event: {
                case: "unitRegistration",
                value: { stateId: event.stateId, params: toJsonObject(event.params) },
              },
            })
          } else if (event.type === "deregistered") {
            yield create(ConnectResponseSchema, {
              event: {
                case: "unitDeregistration",
                value: { stateId: event.stateId },
              },
            })
          }
        }
      } finally {
        services.panelEndpointManager.disconnect(workerInstanceId)
      }
    },

    async updateWorkerVersionMeta(request, context) {
      const requestContext = await authenticateProject(services, request, context)

      const workerVersionId = parseArgument(request, "workerVersionId", z.string())
      const workerMeta = parseArgument(request, "workerMeta", commonObjectMetaSchema)
      const serviceAccountMeta = parseArgument(
        request,
        "serviceAccountMeta",
        serviceAccountMetaSchema.optional(),
      )

      await services.workerService.updateWorkerVersionMeta(
        requestContext,
        workerVersionId,
        workerMeta,
        serviceAccountMeta,
      )

      return {}
    },
  }
}
