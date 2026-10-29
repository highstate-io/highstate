import type { HighstateClients } from "../shared/remote"
import { create } from "@bufbuild/protobuf"
import {
  AddLibraryPackageResponseSchema,
  GetLibraryPackageVersionResponseSchema,
  GetProjectLibraryResponseSchema,
  ListLibraryPackageVersionsResponseSchema,
  RemoveLibraryPackageResponseSchema,
  RetryLibrarySnapshotImageResponseSchema,
  SetLocalLibraryOverlayResponseSchema,
  UpdateAllLibraryPackagesResponseSchema,
  UpdateLibraryPackageResponseSchema,
  UpdateProjectPlacementResponseSchema,
} from "@highstate/api/v1"
import { Cli } from "clipanion"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import registerRemoteCommands from "../register-remote-commands"
import { RemoteCommand } from "./remote"

describe("registered project library commands", () => {
  const library = {
    addLibraryPackage: vi.fn(),
    updateLibraryPackage: vi.fn(),
    removeLibraryPackage: vi.fn(),
    updateAllLibraryPackages: vi.fn(),
    getProjectLibrary: vi.fn(),
    listLibraryPackageVersions: vi.fn(),
    getLibraryPackageVersion: vi.fn(),
    setLocalLibraryOverlay: vi.fn(),
    retryLibrarySnapshotImage: vi.fn(),
  }

  const project = { updateProjectPlacement: vi.fn() }
  let cli: Cli
  let stdout: string
  let stderr: string

  beforeEach(() => {
    cli = new Cli({ binaryName: "highstate" })
    registerRemoteCommands(cli)
    stdout = ""
    stderr = ""

    vi.spyOn(process.stdout, "write").mockImplementation(value => {
      stdout += String(value)
      return true
    })

    vi.spyOn(process.stderr, "write").mockImplementation(value => {
      stderr += String(value)
      return true
    })

    vi.spyOn(RemoteCommand.prototype, "remote").mockResolvedValue({
      clients: { library, project } as unknown as HighstateClients,
      target: { apiUrl: "https://example.test", apiToken: "token", projectId: "project-1" },
    })

    library.addLibraryPackage.mockResolvedValue(create(AddLibraryPackageResponseSchema))
    library.updateLibraryPackage.mockResolvedValue(create(UpdateLibraryPackageResponseSchema))
    library.removeLibraryPackage.mockResolvedValue(create(RemoveLibraryPackageResponseSchema))

    library.updateAllLibraryPackages.mockResolvedValue(
      create(UpdateAllLibraryPackagesResponseSchema),
    )

    library.getProjectLibrary.mockResolvedValue(
      create(GetProjectLibraryResponseSchema, {
        selectedPackages: [{ packageName: "@example/lib", version: "1.2.3" }],
        diagnostics: [{ phase: "resolve", message: "Registry unavailable" }],
        localOverlay: { enabled: true, active: false, conflictingTypes: ["conflict.v1"] },
        desiredSnapshotImage: { phase: 10, error: "Build failed", progress: 0.5 },
      }),
    )

    library.listLibraryPackageVersions.mockResolvedValue(
      create(ListLibraryPackageVersionsResponseSchema, { versions: ["1.2.3"] }),
    )

    library.getLibraryPackageVersion.mockResolvedValue(
      create(GetLibraryPackageVersionResponseSchema),
    )

    library.setLocalLibraryOverlay.mockResolvedValue(create(SetLocalLibraryOverlayResponseSchema))

    library.retryLibrarySnapshotImage.mockResolvedValue(
      create(RetryLibrarySnapshotImageResponseSchema),
    )

    project.updateProjectPlacement.mockResolvedValue(create(UpdateProjectPlacementResponseSchema))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    process.exitCode = 0
  })

  it.each(["add", "update"])("selects an exact scoped package through %s", async action => {
    await cli.run([
      "library",
      "package",
      action,
      "@example/lib",
      "1.2.3-beta.1",
      "--output",
      "json",
    ])

    expect(
      action === "add" ? library.addLibraryPackage : library.updateLibraryPackage,
    ).toHaveBeenCalledWith({
      projectId: "project-1",
      packageName: "@example/lib",
      version: "1.2.3-beta.1",
    })
  })

  it.each([
    "latest",
    "^1.2.3",
    "1.x",
    "v1.2.3",
  ])("rejects nonexact selection %s before contacting backend", async version => {
    await cli.run(["library", "package", "add", "@example/lib", version])
    expect(stderr).toContain("exact semantic version")
    expect(library.addLibraryPackage).not.toHaveBeenCalled()
  })

  it("removes selections and updates all through the atomic endpoint", async () => {
    await cli.run(["library", "package", "remove", "@example/lib"])

    expect(library.removeLibraryPackage).toHaveBeenCalledWith({
      projectId: "project-1",
      packageName: "@example/lib",
    })

    await cli.run(["library", "package", "update-all"])
    expect(library.updateAllLibraryPackages).toHaveBeenCalledWith({ projectId: "project-1" })
    expect(library.updateLibraryPackage).not.toHaveBeenCalled()
  })

  it("lists unresolved selections without requiring a snapshot", async () => {
    await cli.run(["library", "package", "list", "--output", "json"])

    expect(JSON.parse(stdout)).toEqual({
      selected_packages: [{ package_name: "@example/lib", version: "1.2.3" }],
    })
  })

  it("exposes actionable status and overlay conflicts in human output", async () => {
    await cli.run(["library", "status"])
    expect(stdout).toContain("Registry unavailable")
    expect(stdout).toContain("Build failed")
    expect(stdout).toContain("conflict.v1")
  })

  it("lists available versions and retrieves evaluated versions by either lookup", async () => {
    await cli.run(["library", "package", "versions", "@example/lib"])

    expect(library.listLibraryPackageVersions).toHaveBeenCalledWith({
      projectId: "project-1",
      packageName: "@example/lib",
    })

    await cli.run(["library", "package", "get", "version-id"])

    expect(library.getLibraryPackageVersion).toHaveBeenLastCalledWith({
      projectId: "project-1",
      libraryPackageVersionId: "version-id",
      packageName: undefined,
      version: undefined,
    })

    await cli.run([
      "library",
      "package",
      "get",
      "--package-name",
      "@example/lib",
      "--version",
      "1.2.3",
    ])

    expect(library.getLibraryPackageVersion).toHaveBeenLastCalledWith({
      projectId: "project-1",
      libraryPackageVersionId: "",
      packageName: "@example/lib",
      version: "1.2.3",
    })
  })

  it("rejects ambiguous package lookup", async () => {
    await cli.run(["library", "package", "get", "id", "--version", "1.2.3"])
    expect(library.getLibraryPackageVersion).not.toHaveBeenCalled()
    expect(stderr).toContain("Provide a package-version ID")
  })

  it("disables local overlay explicitly and retries desired snapshot", async () => {
    await cli.run(["library", "local-overlay", "disable"])

    expect(library.setLocalLibraryOverlay).toHaveBeenCalledWith({
      projectId: "project-1",
      enabled: false,
    })

    await cli.run(["library", "retry"])
    expect(library.retryLibrarySnapshotImage).toHaveBeenCalledWith({ projectId: "project-1" })
  })

  it.each([
    undefined,
    "disabled",
    "enabled",
  ])("updates placement with overlay %s", async overlay => {
    await cli.run([
      "project",
      "placement",
      "--container-runtime",
      "runtime-1",
      "--pulumi-state-backend",
      "state-1",
      ...(overlay ? ["--local-overlay", overlay] : []),
    ])

    expect(project.updateProjectPlacement).toHaveBeenCalledWith({
      projectId: "project-1",
      containerRuntimeId: "runtime-1",
      pulumiStateBackendId: "state-1",
      localOverlayEnabled: overlay === undefined ? undefined : overlay === "enabled",
    })
  })
})
