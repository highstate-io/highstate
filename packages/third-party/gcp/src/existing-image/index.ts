import { gcp } from "@highstate/library"
import { forUnit, makeEntityOutput } from "@highstate/pulumi"
import * as gcpProvider from "@pulumi/gcp"
import { createProvider } from "../provider"

const { args, inputs, outputs } = forUnit(gcp.existingImage)

type ParsedImageRef = {
  project?: string
  name?: string
  family?: string
}

function parseImageRef(id: string): ParsedImageRef {
  const trimmed = id.trim()

  if (!trimmed) {
    throw new Error("Image ID is empty")
  }

  let normalized = trimmed

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    const url = new URL(trimmed)
    normalized = url.pathname
  }

  normalized = normalized.replace(/^\/compute\/v1\//, "").replace(/^\//, "")

  const familyMatch = normalized.match(/^projects\/([^/]+)\/global\/images\/family\/([^/]+)$/)

  if (familyMatch) {
    return {
      project: familyMatch[1],
      family: familyMatch[2],
    }
  }

  const imageMatch = normalized.match(/^projects\/([^/]+)\/global\/images\/([^/]+)$/)

  if (imageMatch) {
    return {
      project: imageMatch[1],
      name: imageMatch[2],
    }
  }

  return {
    name: trimmed,
  }
}

const provider = await createProvider(inputs.connection)
const parsedImageRef = parseImageRef(args.id)

let resolvedImage: gcpProvider.compute.GetImageResult

if (parsedImageRef.family) {
  resolvedImage = await gcpProvider.compute.getImage(
    {
      family: parsedImageRef.family,
      project: parsedImageRef.project,
    },
    { provider },
  )
} else if (parsedImageRef.name) {
  try {
    resolvedImage = await gcpProvider.compute.getImage(
      {
        name: parsedImageRef.name,
        project: parsedImageRef.project,
      },
      { provider },
    )
  } catch {
    resolvedImage = await gcpProvider.compute.getImage(
      {
        family: parsedImageRef.name,
        project: parsedImageRef.project,
      },
      { provider },
    )
  }
} else {
  throw new Error(`Could not parse image ID "${args.id}"`)
}

const image = makeEntityOutput({
  entity: gcp.imageEntity,
  identity: resolvedImage.selfLink,
  meta: {
    title: resolvedImage.name,
    description: `Project ${resolvedImage.project}`,
  },
  value: {
    id: resolvedImage.selfLink,
  },
})

export default outputs({
  image,

  $statusFields: {
    requestedId: args.id,
    id: resolvedImage.selfLink,
  },
})
