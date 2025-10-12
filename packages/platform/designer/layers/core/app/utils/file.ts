import type { FileMeta } from "@highstate/contract"

const contentTypeToIcon: Record<string, string> = {
  "application/x-yaml": "devicon-plain:yaml",
}

const extensionToIcon: Record<string, string> = {
  yaml: "devicon-plain:yaml",
  yml: "devicon-plain:yaml",
  zip: "devicon-plain:zip",
}

export function getFileIcon(fileMeta: FileMeta): string {
  const extension = fileMeta.name.split(".").pop()

  return (
    contentTypeToIcon[fileMeta.contentType ?? ""] ?? extensionToIcon[extension ?? ""] ?? "mdi:file"
  )
}
