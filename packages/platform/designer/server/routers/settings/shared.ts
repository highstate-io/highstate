import { z } from "zod"

export const projectInput = z.object({ projectId: z.cuid2() })
export const roleInput = projectInput.extend({ roleId: z.cuid2() })
export const apiKeyInput = projectInput.extend({ apiKeyId: z.cuid2() })
export const serviceAccountInput = projectInput.extend({ serviceAccountId: z.cuid2() })
export const roleBindingInput = roleInput.extend({ serviceAccountId: z.cuid2() })
