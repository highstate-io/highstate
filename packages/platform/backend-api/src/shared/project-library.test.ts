import { LibraryCatalogSourceKind, LibrarySnapshotImagePhase } from "@highstate/api/v1"
import { describe, expect, it } from "vitest"
import { toCatalogSource, toLocalOverlay, toSnapshotImage } from "./project-library"

describe("project library conversion", () => {
  it("exposes persisted image phase progress and failure without losing zero progress", () => {
    const image = toSnapshotImage({
      id: "image",
      projectId: "project",
      snapshotId: "snapshot",
      snapshotHash: "hash",
      runtimeId: "runtime",
      status: "failed",
      generation: 2,
      progress: { message: "Installing frozen graph", progress: 0 },
      imageRef: null,
      imageDigest: null,
      imageHash: null,
      error: "Registry unavailable",
      updatedAt: new Date(0),
      completedAt: null,
    })

    expect(image).toMatchObject({
      phase: LibrarySnapshotImagePhase.FAILED,
      generation: 2n,
      progress: 0,
      message: "Installing frozen graph",
      error: "Registry unavailable",
      librarySnapshotId: "snapshot",
      containerRuntimeId: "runtime",
    })

    expect(toSnapshotImage(null)).toBeUndefined()
  })

  it("keeps npm versions distinct from component types and explains inactive overlays", () => {
    expect(
      toCatalogSource({
        kind: "package",
        packageName: "@example/library",
        version: "2.3.4",
        snapshotId: "snapshot",
      }),
    ).toMatchObject({
      kind: LibraryCatalogSourceKind.PACKAGE,
      packageName: "@example/library",
      packageVersion: "2.3.4",
      librarySnapshotId: "snapshot",
    })

    expect(toCatalogSource({ kind: "local" })?.kind).toBe(LibraryCatalogSourceKind.LOCAL)

    expect(
      toLocalOverlay({
        enabled: true,
        active: false,
        conflicts: ["components:example.unit.v1"],
        reason: "Conflicting definitions",
      }),
    ).toMatchObject({
      enabled: true,
      active: false,
      message: "Conflicting definitions",
      conflictingTypes: ["components:example.unit.v1"],
    })
  })
})
