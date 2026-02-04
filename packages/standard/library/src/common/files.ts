import type { Simplify } from "type-fest"
import {
  fileContentSchema as baseFileContentSchema,
  fileMetaSchema as baseFileMetaSchema,
  defineEntity,
  defineUnit,
  type EntityInput,
  unitArtifactSchema,
  z,
} from "@highstate/contract"
import { l7EndpointEntity } from "../network"

export const checksumAlgorithmSchema = z.enum(["md5", "sha1", "sha256", "sha384", "sha512"])

export const checksumSchema = z.object({
  algorithm: checksumAlgorithmSchema,
  value: z.string(),
})

export const fileContentSchema = z.union([
  baseFileContentSchema,
  z.object({
    type: z.literal("local"),
    path: z.string(),
  }),
  z.object({
    type: z.literal("remote"),
    endpoint: l7EndpointEntity.schema,
    checksum: checksumSchema.optional(),
  }),
])

export const fileEntity = defineEntity({
  type: "common.file.v1",

  schema: z.object({
    meta: baseFileMetaSchema,
    content: fileContentSchema,
  }),

  meta: {
    color: "#FF5722",
  },
})

export const folderMetaSchema = z.object({
  name: z.string(),
  mode: z.number().optional(),
})

export const folderContentSchema = z.union([
  z.object({
    type: z.literal("embedded"),
    files: fileEntity.schema.array(),
    folders: z
      .object({
        meta: folderMetaSchema,
        get content() {
          return folderContentSchema
        },
      })
      .array(),
  }),
  z.object({
    type: z.literal("artifact"),
    ...unitArtifactSchema.shape,
  }),
  z.object({
    type: z.literal("local"),
    path: z.string(),
  }),
  z.object({
    type: z.literal("remote"),
    endpoint: l7EndpointEntity.schema,
  }),
])

export const folderEntity = defineEntity({
  type: "common.folder.v1",

  schema: z.object({
    meta: folderMetaSchema,
    content: folderContentSchema,
  }),

  meta: {
    color: "#FF9800",
  },
})

/**
 * References a file from a remote URL.
 */
export const remoteFile = defineUnit({
  type: "common.remote-file.v1",

  args: {
    /**
     * The URL of the remote file.
     *
     * Either this or the 'endpoint' input must be provided.
     */
    url: z.string().optional(),

    /**
     * The name of the file.
     *
     * If not provided, the name will be derived from the URL or endpoint path.
     * If not possible, the name of the unit will be used.
     */
    fileName: z.string().optional(),
  },

  inputs: {
    /**
     * The L7 endpoint of the remote file.
     */
    endpoint: {
      entity: l7EndpointEntity,
      required: false,
    },
  },

  outputs: {
    file: fileEntity,
  },

  meta: {
    title: "Remote File",
    icon: "mdi:file-download",
    category: "Files",
  },

  source: {
    package: "@highstate/common",
    path: "units/remote-file",
  },
})

export type File = z.infer<typeof fileEntity.schema>
export type FileInput = EntityInput<typeof fileEntity>
export type FileMeta = z.infer<typeof baseFileMetaSchema>
export type FileContent = z.infer<typeof fileContentSchema>

export type EmbeddedFile = Simplify<File & { content: { type: "embedded" } }>
export type ArtifactFile = Simplify<File & { content: { type: "artifact" } }>
export type LocalFile = Simplify<File & { content: { type: "local" } }>
export type RemoteFile = Simplify<File & { content: { type: "remote" } }>

export type Folder = z.infer<typeof folderEntity.schema>
export type FolderInput = EntityInput<typeof folderEntity>
export type FolderMeta = z.infer<typeof folderMetaSchema>
export type FolderContent = z.infer<typeof folderContentSchema>

export type EmbeddedFolder = Simplify<Folder & { content: { type: "embedded" } }>
export type ArtifactFolder = Simplify<Folder & { content: { type: "artifact" } }>
export type LocalFolder = Simplify<Folder & { content: { type: "local" } }>
export type RemoteFolder = Simplify<Folder & { content: { type: "remote" } }>

export type Checksum = z.infer<typeof checksumSchema>
export type ChecksumAlgorithm = z.infer<typeof checksumAlgorithmSchema>
