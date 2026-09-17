#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const RELEASE_GROUPS = {
  platform: "packages/platform/contract",
  stdlib: "packages/standard/library",
} as const;

export function currentReleaseNotes(
  changelog: string,
  version: string,
): string {
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const heading = new RegExp(`^## ${escapedVersion}(?: |$)`, "m");
  const match = heading.exec(changelog);
  if (!match) {
    throw new Error(`Changelog does not contain release ${version}`);
  }
  const end = changelog.indexOf("\n## ", match.index + match[0].length);
  return changelog.slice(match.index, end === -1 ? undefined : end).trim();
}

export function groupReleaseNotes(
  changelogs: string[],
  version: string,
): string {
  const entries = new Set<string>();
  for (const changelog of changelogs) {
    const section = currentReleaseNotes(changelog, version);
    for (const match of section.matchAll(
      /^- (?!Updated dependencies\b)[\s\S]*?(?=\n- |\n### |\n## |(?![\s\S]))/gm,
    )) {
      entries.add(match[0].trim());
    }
  }

  const body =
    entries.size > 0
      ? `### Changes\n\n${[...entries].join("\n\n")}`
      : "This release contains dependency updates only.";
  return `## ${version}\n\n${body}`;
}

async function readGroupChangelogs(
  root: string,
  packageNames: string[],
): Promise<string[]> {
  const changelogs = new Map<string, string>();
  const manifests = new Bun.Glob("packages/*/*/package.json");
  for await (const path of manifests.scan({ cwd: root, absolute: true })) {
    const manifest = JSON.parse(await readFile(path, "utf8")) as {
      name?: string;
    };
    if (manifest.name && packageNames.includes(manifest.name)) {
      changelogs.set(
        manifest.name,
        await readFile(resolve(path, "../CHANGELOG.md"), "utf8"),
      );
    }
  }

  const missing = packageNames.filter((name) => !changelogs.has(name));
  if (missing.length > 0) {
    throw new Error(`Unable to find changelogs for: ${missing.join(", ")}`);
  }
  return packageNames.map((name) => changelogs.get(name)!);
}

export async function createGithubReleases(root: string): Promise<void> {
  for (const [group, relativePath] of Object.entries(RELEASE_GROUPS)) {
    const packageRoot = resolve(root, relativePath);
    const manifest = JSON.parse(
      await readFile(resolve(packageRoot, "package.json"), "utf8"),
    ) as {
      version: string;
      highstate: { release: { packages: string[] } };
    };
    const tag = `${group}@v${manifest.version}`;
    const existing = Bun.spawnSync(["gh", "release", "view", tag], {
      cwd: root,
      stdout: "ignore",
      stderr: "ignore",
    });
    if (existing.exitCode === 0) {
      continue;
    }

    const changelogs = await readGroupChangelogs(
      root,
      manifest.highstate.release.packages,
    );
    const notes = groupReleaseNotes(changelogs, manifest.version);
    const release = Bun.spawnSync(
      [
        "gh",
        "release",
        "create",
        tag,
        "--target",
        "main",
        "--title",
        tag,
        "--notes",
        notes,
      ],
      { cwd: root, stdout: "inherit", stderr: "inherit" },
    );
    if (release.exitCode !== 0) {
      throw new Error(`Unable to create GitHub release ${tag}`);
    }
  }
}

if (import.meta.main) {
  await createGithubReleases(resolve(import.meta.dirname, ".."));
}
