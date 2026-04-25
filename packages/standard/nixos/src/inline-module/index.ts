import { common, nixos } from "@highstate/library"
import { forUnit, makeEntityOutput, makeFile } from "@highstate/pulumi"

const {
  name,
  stateId,
  args,
  inputs: { files, folders },
  outputs,
} = forUnit(nixos.inlineModule)

const moduleName = args.moduleName ?? name

export default outputs({
  folder: makeEntityOutput({
    entity: common.folderEntity,
    identity: stateId,
    meta: {
      title: moduleName,
    },
    value: {
      meta: {
        name: moduleName,
      },
      content: {
        type: "embedded",
      },
      files: [
        ...files,
        makeFile({
          name: "default.nix",
          content: args.code,
        }),
      ],
      folders,
    },
  }),
})
