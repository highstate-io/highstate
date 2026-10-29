import type { ServiceImpl } from "@connectrpc/connect"
import type { Services } from "@highstate/backend"
import { Code, ConnectError } from "@connectrpc/connect"
import { ComponentKind, type LibraryService } from "@highstate/api/v1"
import { libraryPackageInputSchema, libraryPackageNameInputSchema } from "@highstate/backend"
import { ComponentNotFoundError } from "@highstate/backend/shared"
import { z } from "@highstate/contract"
import { authenticateProject, parseArgument, parseValue, toComponent, toLibrary } from "../shared"
import {
  toCatalogSource,
  toLibrarySnapshot,
  toLocalOverlay,
  toSnapshotImage,
} from "../shared/project-library"

export function createLibraryService(services: Services): ServiceImpl<typeof LibraryService> {
  return {
    async getProjectLibrary(request, context) {
      const auth = await authenticateProject(services, request, context)

      const [state, catalog] = await Promise.all([
        services.projectLibraryService.getProjectLibrary(auth),
        services.projectLibraryService.getCatalog(auth),
      ])

      return {
        selectedPackages: state.selectedPackages,
        desiredSnapshot: state.desiredSnapshot
          ? toLibrarySnapshot(state.desiredSnapshot)
          : undefined,
        desiredSnapshotImage: toSnapshotImage(state.image),
        localOverlay: toLocalOverlay(catalog.overlay),
        diagnostics: state.diagnostics,
      }
    },
    async addLibraryPackage(request, context) {
      const auth = await authenticateProject(services, request, context)

      const selection = parseValue(
        { packageName: request.packageName, version: request.version },
        "package",
        libraryPackageInputSchema,
      )

      const snapshot = await services.projectLibraryService.addPackage(auth, selection)
      return { package: selection, desiredSnapshot: toLibrarySnapshot(snapshot) }
    },
    async updateLibraryPackage(request, context) {
      const auth = await authenticateProject(services, request, context)

      const selection = parseValue(
        { packageName: request.packageName, version: request.version },
        "package",
        libraryPackageInputSchema,
      )

      const snapshot = await services.projectLibraryService.updatePackage(auth, selection)
      return { package: selection, desiredSnapshot: toLibrarySnapshot(snapshot) }
    },
    async removeLibraryPackage(request, context) {
      const auth = await authenticateProject(services, request, context)

      const input = parseValue(
        { packageName: request.packageName },
        "package",
        libraryPackageNameInputSchema,
      )

      return {
        desiredSnapshot: toLibrarySnapshot(
          await services.projectLibraryService.removePackage(auth, input),
        ),
      }
    },
    async updateAllLibraryPackages(request, context) {
      const auth = await authenticateProject(services, request, context)
      const snapshot = await services.projectLibraryService.updateAll(auth)
      return {
        selectedPackages: snapshot.selectedPackages,
        desiredSnapshot: toLibrarySnapshot(snapshot),
      }
    },
    async listLibraryPackageVersions(request, context) {
      const auth = await authenticateProject(services, request, context)

      const input = parseValue(
        { packageName: request.packageName },
        "package",
        libraryPackageNameInputSchema,
      )

      return { versions: await services.projectLibraryService.listPackageVersions(auth, input) }
    },
    async getLibraryPackageVersion(request, context) {
      const auth = await authenticateProject(services, request, context)
      const state = await services.projectLibraryService.getProjectLibrary(auth)

      const member = state.desiredSnapshot?.packages.find(
        pkg => pkg.id === request.libraryPackageVersionId,
      )

      if (request.libraryPackageVersionId && !member) {
        throw new ConnectError(
          "Package version is not in the desired project snapshot; provide package name and exact version",
          Code.NotFound,
        )
      }

      const selection = parseValue(
        {
          packageName: member?.packageName ?? request.packageName,
          version: member?.version ?? request.version,
        },
        "package",
        libraryPackageInputSchema,
      )

      const metadata =
        member?.packageMetadata ??
        (await services.projectLibraryService.getPackageVersion(auth, selection))

      return {
        packageVersion: {
          id: member?.id,
          packageName: selection.packageName,
          version: selection.version,
          registryUrl: member?.registryUrl,
          packageIntegrity: member?.packageIntegrity,
          packageMetadata: {
            description: metadata.description ?? null,
            homepage: metadata.homepage ?? null,
            license: metadata.license ?? null,
            engines: metadata.engines ?? {},
          },
        },
      }
    },
    async setLocalLibraryOverlay(request, context) {
      const auth = await authenticateProject(services, request, context)

      const catalog = await services.projectLibraryService.setLocalOverlay(auth, {
        enabled: request.enabled,
      })

      return { localOverlay: toLocalOverlay(catalog.overlay) }
    },
    async retryLibrarySnapshotImage(request, context) {
      const auth = await authenticateProject(services, request, context)
      await services.projectLibraryService.retryDesiredImage(auth)
      const state = await services.projectLibraryService.getProjectLibrary(auth)
      return { image: toSnapshotImage(state.image) }
    },
    async getLibrary(request, context) {
      const requestContext = await authenticateProject(services, request, context)
      const library = await services.libraryService.getLibraryModel(requestContext, context.signal)
      const catalog = await services.projectLibraryService.getCatalog(requestContext)

      return {
        library: toLibrary(
          {
            components: { ...library.components },
            entities: { ...library.entities },
          },
          catalog,
        ),
      }
    },

    async listComponents(request, context) {
      const requestContext = await authenticateProject(services, request, context)

      const page = await services.libraryService.getComponents(
        requestContext,
        { pageSize: request.pageSize, pageToken: request.pageToken },
        context.signal,
      )

      const catalog = await services.projectLibraryService.getCatalog(requestContext)

      return {
        components: page.items.map(component => ({
          type: component.type,
          source: toCatalogSource(catalog.sources[`components:${component.type}`]),
          kind: component.kind === "unit" ? ComponentKind.UNIT : ComponentKind.COMPOSITE,
          meta: {
            title: component.meta.title,
            description: component.meta.description,
            color: component.meta.color,
            icon: component.meta.icon,
            iconColor: component.meta.iconColor,
            secondaryIcon: component.meta.secondaryIcon,
            secondaryIconColor: component.meta.secondaryIconColor,
            category: component.meta.category,
            defaultNamePrefix: component.meta.defaultNamePrefix,
          },
        })),
        nextPageToken: page.nextPageToken,
      }
    },

    async getComponent(request, context) {
      const requestContext = await authenticateProject(services, request, context)
      const type = parseArgument(request, "type", z.string().min(1))
      const library = await services.libraryService.getLibraryModel(requestContext, context.signal)
      const component = library.components[type]
      if (!component) {
        throw new ComponentNotFoundError(requestContext.projectId, type)
      }

      const catalog = await services.projectLibraryService.getCatalog(requestContext)
      return {
        component: {
          ...toComponent(component),
          source: toCatalogSource(catalog.sources[`components:${type}`]),
        },
      }
    },
  }
}
