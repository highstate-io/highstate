#!/usr/bin/env bun
import { readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

export function withWorkspaceVersions(
  lockfile: string,
  versions: Map<string, string>,
): string {
  for (const [path, version] of versions) {
    const start = lockfile.indexOf(`    "${path}": {`);
    if (start === -1) {
      throw new Error(`Bun lockfile does not contain workspace "${path}"`);
    }
    const end = lockfile.indexOf("\n    },", start);
    const workspace = lockfile.slice(start, end);
    const updated = workspace.replace(
      /^(      "version": ")[^"]+(",)$/m,
      `$1${version}$2`,
    );
    if (
      updated === workspace &&
      !workspace.includes(`"version": "${version}"`)
    ) {
      throw new Error(`Bun lockfile workspace "${path}" has no version`);
    }
    lockfile = `${lockfile.slice(0, start)}${updated}${lockfile.slice(end)}`;
  }
  return lockfile;
}

export async function synchronizeWorkspaceLockfile(
  root: string,
): Promise<void> {
  const manifest = (await Bun.file(resolve(root, "package.json")).json()) as {
    workspaces: string[];
  };
  const versions = new Map<string, string>();
  for (const pattern of manifest.workspaces) {
    for await (const path of new Bun.Glob(`${pattern}/package.json`).scan({
      cwd: root,
      absolute: true,
    })) {
      const workspace = (await Bun.file(path).json()) as { version?: string };
      if (workspace.version) {
        versions.set(relative(root, resolve(path, "..")), workspace.version);
      }
    }
  }

  const path = resolve(root, "bun.lock");
  const lockfile = await readFile(path, "utf8");
  await writeFile(path, withWorkspaceVersions(lockfile, versions));
}

if (import.meta.main) {
  await synchronizeWorkspaceLockfile(resolve(import.meta.dirname, ".."));
}
