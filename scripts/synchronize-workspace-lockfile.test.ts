import { expect, test } from "vitest";
import { withWorkspaceVersions } from "./synchronize-workspace-lockfile";

test("updates workspace versions without changing dependency protocols", () => {
  const lockfile = `{
  "workspaces": {
    "packages/example": {
      "name": "@highstate/example",
      "version": "1.0.0",
      "dependencies": {
        "@highstate/contract": "workspace:*",
      },
    },
  },
}\n`;

  expect(
    withWorkspaceVersions(lockfile, new Map([["packages/example", "1.1.0"]])),
  ).toBe(lockfile.replace('"version": "1.0.0"', '"version": "1.1.0"'));
});

test("rejects workspaces missing from the lockfile", () => {
  expect(() =>
    withWorkspaceVersions("{\n}\n", new Map([["packages/example", "1.1.0"]])),
  ).toThrow('Bun lockfile does not contain workspace "packages/example"');
});
