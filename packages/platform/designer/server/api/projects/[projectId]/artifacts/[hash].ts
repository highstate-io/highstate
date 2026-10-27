import { getSharedServices, requireProjectPermission } from "@highstate/backend"
import { PermissionDeniedError } from "@highstate/backend/shared"
import { authenticateProjectHeaders } from "../../../../utils/request-authentication"
import { isHostedAuth } from "../../../../utils/auth-config"

export default defineEventHandler(async event => {
  setHeader(event, "Cache-Control", "private, no-store")
  const projectId = getRouterParam(event, "projectId")
  const hash = getRouterParam(event, "hash")
  if (!projectId || !hash) {
    throw createError({
      statusCode: 400,
      statusMessage: "Missing projectId or hash",
    })
  }

  const services = await getSharedServices()
  const headers = new Headers(getHeaders(event) as Record<string, string>)
  const context = await authenticateProjectHeaders(services, headers, projectId)

  try {
    // get artifact metadata from database
    const database = await services.database.forProject(projectId)
    const artifact = await database.artifact.findUnique({ where: { hash } })
    if (!artifact) {
      throw createError({
        statusCode: 404,
        statusMessage: "Artifact not found",
      })
    }
    requireProjectPermission(context, "artifact.get", { resourceId: artifact.id })

    // retrieve artifact content from backend
    const contentIterable = await services.artifactBackend.retrieve(
      projectId,
      artifact.hash,
      artifact.chunkSize,
    )

    if (!contentIterable) {
      throw createError({
        statusCode: 404,
        statusMessage: "Artifact content not found in storage",
      })
    }

    // set response headers based on artifact metadata
    setResponseStatus(event, 200)

    // extract content type and filename from metadata if available
    const meta = artifact.meta as { contentType?: string; name?: string; filename?: string }
    if (meta.contentType) {
      setHeader(event, "Content-Type", meta.contentType)
    }

    // use name from meta, fallback to filename
    const filename = meta.name || meta.filename || "download"
    setHeader(event, "Content-Disposition", `attachment; filename="${filename}"`)

    setHeader(event, "Content-Length", artifact.size)
    event.node.res.flushHeaders()

    // stream content chunks to response
    for await (const chunk of contentIterable) {
      if (isHostedAuth()) {
        const current = await authenticateProjectHeaders(services, headers, projectId)
        requireProjectPermission(current, "artifact.get", { resourceId: artifact.id })
      }
      event.node.res.write(chunk)
    }

    event.node.res.end()
  } catch (error) {
    if (error instanceof PermissionDeniedError)
      throw createError({ statusCode: 403, statusMessage: "Permission denied" })
    // if it's already a createError, re-throw it
    if (error && typeof error === "object" && "statusCode" in error) {
      throw error
    }

    // otherwise, wrap in a generic server error
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to retrieve artifact",
      cause: error,
    })
  }
})
