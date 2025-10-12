import type { WorkerServiceImplementation } from "@highstate/api/worker.v1"
import type { Services } from "@highstate/backend"
import { commonObjectMetaSchema, z } from "@highstate/contract"
import { authenticate, parseArgument } from "../shared"

export function createWorkerService(services: Services): WorkerServiceImplementation {
  return {
    async *connect(request, context) {
      const [projectId] = await authenticate(services, context)

      const workerVersionId = parseArgument(request, "workerVersionId", z.cuid2())

      // set worker as running
      services.workerManager.setWorkerRunning(projectId, workerVersionId)

      // get existing registrations for this worker version
      const database = await services.database.forProject(projectId)
      const existingRegistrations = await database.workerUnitRegistration.findMany({
        where: { workerVersionId },
        select: { stateId: true, params: true },
      })

      // emit existing registrations
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

      // subscribe to new registration events for this worker version
      const registrationStream = await services.pubsubManager.subscribe([
        "worker-unit-registration",
        projectId,
        workerVersionId,
      ])

      // emit new registration/deregistration events
      for await (const event of registrationStream) {
        if (event.type === "registered") {
          yield {
            event: {
              $case: "unitRegistration",
              value: {
                instanceId: event.instanceId,
                params: event.params,
              },
            },
          }
        } else if (event.type === "deregistered") {
          yield {
            event: {
              $case: "unitDeregistration",
              value: {
                instanceId: event.instanceId,
              },
            },
          }
        }
      }
    },

    async updateWorkerVersionMeta(request, context) {
      const [projectId] = await authenticate(services, context)

      const workerVersionId = parseArgument(request, "workerVersionId", z.string())
      const meta = parseArgument(request, "meta", commonObjectMetaSchema)

      await services.workerService.updateWorkerVersionMeta(projectId, workerVersionId, meta)

      return {}
    },
  }
}
