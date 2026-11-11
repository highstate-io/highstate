import type {
  CatalogSource,
  ProjectLibraryCatalog,
  ProjectLibrarySnapshot,
} from "@highstate/backend"
import { create } from "@bufbuild/protobuf"
import { timestampFromDate } from "@bufbuild/protobuf/wkt"
import {
  LibraryCatalogSourceKind,
  LibraryCatalogSourceSchema,
  LibrarySnapshotImagePhase,
  LibrarySnapshotImageSchema,
  LibrarySnapshotSchema,
  LocalLibraryOverlaySchema,
} from "@highstate/api/v1"
import { z } from "@highstate/contract"

export function toCatalogSource(source: CatalogSource | undefined) {
  if (!source) {
    return undefined
  }

  if (source.kind === "package") {
    return create(LibraryCatalogSourceSchema, {
      kind: LibraryCatalogSourceKind.PACKAGE,
      packageName: source.packageName,
      packageVersion: source.version,
      librarySnapshotId: source.snapshotId,
    })
  }

  return create(LibraryCatalogSourceSchema, {
    kind:
      source.kind === "local" ? LibraryCatalogSourceKind.LOCAL : LibraryCatalogSourceKind.VIRTUAL,
  })
}

export function toLocalOverlay(overlay: ProjectLibraryCatalog["overlay"]) {
  return create(LocalLibraryOverlaySchema, {
    enabled: overlay.enabled,
    active: overlay.active,
    message: overlay.reason,
    conflictingTypes: overlay.conflicts,
    revision: overlay.revision,
  })
}

export function toLibrarySnapshot(snapshot: ProjectLibrarySnapshot) {
  return create(LibrarySnapshotSchema, {
    id: snapshot.id,
    hash: snapshot.hash,
    versions: snapshot.packages.map(pkg => ({
      packageName: pkg.packageName,
      version: pkg.version,
      libraryPackageVersionId: pkg.id,
    })),
    compatibility: snapshot.compatibility,
  })
}

const imageSchema = z.object({
  id: z.string(),
  snapshotId: z.string(),
  snapshotHash: z.string(),
  runtimeId: z.string(),
  status: z.enum(["queued", "installing", "building", "pushing", "verifying", "ready", "failed"]),
  generation: z.number().int(),
  progress: z
    .object({ message: z.string().optional(), progress: z.number().min(0).max(1).optional() })
    .nullable()
    .optional(),
  imageRef: z.string().nullable().optional(),
  imageDigest: z.string().nullable().optional(),
  imageHash: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  updatedAt: z.date(),
  completedAt: z.date().nullable().optional(),
})
const phases = {
  queued: LibrarySnapshotImagePhase.QUEUED,
  installing: LibrarySnapshotImagePhase.INSTALLING,
  building: LibrarySnapshotImagePhase.BUILDING,
  pushing: LibrarySnapshotImagePhase.PUSHING,
  verifying: LibrarySnapshotImagePhase.VERIFYING,
  ready: LibrarySnapshotImagePhase.READY,
  failed: LibrarySnapshotImagePhase.FAILED,
}

export function toSnapshotImage(value: unknown) {
  if (value == null) {
    return undefined
  }

  const image = imageSchema.parse(value)
  return create(LibrarySnapshotImageSchema, {
    id: image.id,
    librarySnapshotId: image.snapshotId,
    librarySnapshotHash: image.snapshotHash,
    containerRuntimeId: image.runtimeId,
    phase: phases[image.status],
    generation: BigInt(image.generation),
    progress: image.progress?.progress,
    message: image.progress?.message,
    imageRef: image.imageRef ?? undefined,
    imageDigest: image.imageDigest ?? undefined,
    imageHash: image.imageHash ?? undefined,
    error: image.error ?? undefined,
    updatedAt: timestampFromDate(image.updatedAt),
    completedAt: image.completedAt ? timestampFromDate(image.completedAt) : undefined,
  })
}
