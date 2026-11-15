import { isHostedAuth } from "../utils/auth-config"

export default defineEventHandler(event => {
  setHeader(event, "Cache-Control", "no-store")
  return sendRedirect(event, isHostedAuth() ? "/api/auth/login" : "/")
})
