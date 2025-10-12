import type { types } from "@highstate/cert-manager"
import type { Namespace } from "./namespace"
import { ImplementationMediator } from "@highstate/common"
import { z } from "@highstate/contract"

export const dns01SolverMediator = new ImplementationMediator(
  "dns01-solver",
  z.object({ namespace: z.custom<Namespace>() }),
  z.custom<types.input.cert_manager.v1.ClusterIssuerSpecAcmeSolversDns01>(),
)
