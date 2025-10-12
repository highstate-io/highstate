import type { File } from "@highstate/contract"

/**
 * Generates a URL for downloading or accessing a file.
 * Handles both embedded content (base64 data URLs) and artifact references (API endpoints).
 */
export function getFileUrl(file: File, projectId: string): string {
  if (file.content.type === "artifact") {
    // for artifact references, use the hash to fetch from backend
    // the backend will look up the artifact by hash
    return `/api/projects/${projectId}/artifacts/${file.content.hash}`
  }

  // for embedded content, create a data URL
  const mimeType = file.meta.contentType || "application/octet-stream"

  // if content is binary, it's already base64 encoded
  if (file.content.isBinary) {
    return `data:${mimeType};base64,${file.content.value}`
  }

  // for text content, encode to base64
  const base64 = btoa(file.content.value)
  return `data:${mimeType};base64,${base64}`
}
