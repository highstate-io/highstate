import { z, type ComponentArgument } from "@highstate/contract"
import { describe, expect, test } from "vitest"
import { createEditorArguments } from "."

describe("createEditorArguments", () => {
  test("creates a combobox for arrays of same-type unions", () => {
    const schema = z.toJSONSchema(z.union([z.ipv4(), z.ipv6()]).array().default([]), {
      target: "draft-7",
      io: "input",
      unrepresentable: "any",
    })
    const args: Record<string, ComponentArgument> = {
      network: {
        schema: {
          type: "object",
          properties: { dns: schema },
          default: { dns: [] },
        },
        required: true,
        meta: { title: "Network" },
      },
    }

    const result = createEditorArguments("proxmox.virtual-machine.v1", args)

    expect(result.expandableArguments).toEqual([
      expect.objectContaining({
        name: "network",
        kind: "group",
        fields: {
          "": [
            expect.objectContaining({
              name: "dns",
              kind: "combobox",
              type: "string",
            }),
          ],
        },
      }),
    ])
  })
})
