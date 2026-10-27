# Container Images

`docker-bake.hcl` is the shared build entry point for repository-owned images.
Run Bake from the workspace root so its build contexts resolve correctly:

```sh
docker buildx bake --file docker/docker-bake.hcl images --print
docker buildx bake --file docker/docker-bake.hcl apps-exetrouter --load
```

## Layout And Naming

`docker/core/` contains Dockerfiles for Highstate's own runtime images, including terminals and workers.
Worker build contexts remain in their owning packages so they can copy compiled package artifacts.
Existing core image names, such as `terminal.kubectl` and `worker.k8s-monitor`, remain stable.
Bake target names use `core-` and `apps-` prefixes, such as `core-terminal-kubectl` and `apps-exetrouter`.
Legacy unprefixed core targets remain as compatibility aliases for preview workflows using an older trusted selector.

External applications packaged for Highstate use the `apps/` image prefix.
Their Dockerfiles, entrypoints, configuration, and container tests live together in `docker/apps/<app>/`.
For example, `docker/apps/exetrouter/` builds `ghcr.io/highstate-io/apps/exetrouter`.
Preview publication uses the same suffix under the preview prefix: `ghcr.io/highstate-io/dev/apps/exetrouter`.

Bake has no native HCL include directive.
The root Bake file defines the shared variables, image group, and targets, referencing the artifact folders directly.

## Adding An Application Image

Create `docker/apps/<app>/` and add an `apps-<app>` target to the root Bake file with `image_tags("apps/<app>")`.
Register the target in the `images` group and update `scripts/affected-image-targets.ts` so artifact changes rebuild it.
The owning unit package's `assets/images.json` records the full repository name, including `apps/`.
Release tooling replaces the image reference with the published digest.

Container smoke tests live beside their Dockerfile and run through `docker-images:test`.
The ExetRouter smoke test exercises API authentication, restricted SSH management, and encrypted backup restoration.
