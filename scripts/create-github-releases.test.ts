import { expect, test } from "vitest";
import {
  currentReleaseNotes,
  groupReleaseNotes,
} from "./create-github-releases";

test("extracts the current version section from a changelog", () => {
  expect(
    currentReleaseNotes(
      "## 1.2.0 (2026-09-15)\n\nNew release.\n\n## 1.1.0\n\nOld release.\n",
      "1.2.0",
    ),
  ).toBe("## 1.2.0 (2026-09-15)\n\nNew release.");
});

test("matches complete version headings", () => {
  expect(() =>
    currentReleaseNotes("## 1.20.0\n\nNew release.\n", "1.2.0"),
  ).toThrow("Changelog does not contain release 1.2.0");
  expect(
    currentReleaseNotes("## 1.2.0+build.1\n\nNew release.\n", "1.2.0+build.1"),
  ).toBe("## 1.2.0+build.1\n\nNew release.");
});

test("combines unique direct changes from every package changelog", () => {
  const directChange =
    "- [#36](https://github.com/highstate-io/highstate/pull/36) - Add Hetzner Cloud units.";
  expect(
    groupReleaseNotes(
      [
        `## 0.31.1\n\n### Patch Changes\n\n${directChange}\n\n- Updated dependencies []:\n  - @highstate/contract@0.31.1\n`,
        `## 0.31.1\n\n### Patch Changes\n\n${directChange}\n`,
        "## 0.31.1\n",
      ],
      "0.31.1",
    ),
  ).toBe(`## 0.31.1\n\n### Changes\n\n${directChange}`);
});

test("describes a release containing only dependency updates", () => {
  expect(
    groupReleaseNotes(
      [
        "## 2.0.0\n\n### Patch Changes\n\n- Updated dependencies []:\n  - @highstate/contract@2.0.0\n",
      ],
      "2.0.0",
    ),
  ).toBe("## 2.0.0\n\nThis release contains dependency updates only.");
});
