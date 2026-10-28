import { isHostedAuth } from "../utils/auth-config"
import { getCanonicalDesignerUrl } from "../utils/designer-host"

export default defineEventHandler(event => {
  if (isHostedAuth()) {
    return
  }

  const redirectDisabled = process.env.HIGHSTATE_DESIGNER_NO_REDIRECT !== undefined
  const canonicalUrl = getCanonicalDesignerUrl(getRequestURL(event), redirectDisabled)
  if (!canonicalUrl) {
    return
  }

  return sendRedirect(event, canonicalUrl, 307)
})
