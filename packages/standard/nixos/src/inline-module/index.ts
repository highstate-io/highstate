import { nixos } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"

const { name, args, inputs, outputs } = forUnit(nixos.inlineModule)

const moduleName = args.moduleName ?? name
const { files, folders } = await toPromise(inputs)

export default outputs({
  folder: {
    meta: {
      name: moduleName,
    },
    content: {
      type: "embedded",
      files: [
        ...(files ?? []),
        {
          meta: {
            name: "default.nix",
          },
          content: {
            type: "embedded",
            value: args.code,
          },
        },
      ],
      folders: folders ?? [],
    },
  },
})
