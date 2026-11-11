import { getHostedAuthConfig, isHostedAuth } from "../../utils/auth-config"

export default defineEventHandler(event => {
  setHeader(event, "Cache-Control", "no-store")
  return {
    mode: isHostedAuth() ? "hosted" : "local",
    providers: isHostedAuth()
      ? getHostedAuthConfig().providers.map(({ id, title }) => ({ id, title }))
      : [],
  }
})
