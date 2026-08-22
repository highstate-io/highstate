import { getCanonicalDesignerUrl } from "../utils/designer-host"

export default defineEventHandler(event => {
  const redirectDisabled = process.env.HIGHSTATE_DESIGNER_NO_REDIRECT !== undefined
  const canonicalUrl = getCanonicalDesignerUrl(getRequestURL(event), redirectDisabled)
  if (!canonicalUrl) {
    return
  }

  return sendRedirect(event, canonicalUrl, 307)
})
