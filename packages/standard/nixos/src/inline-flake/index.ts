import { access, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Command, MaterializedFile, MaterializedFolder } from "@highstate/common"
import { text } from "@highstate/contract"
import { MaterializedRepository } from "@highstate/git"
import { nixos } from "@highstate/library"
import { forUnit, toPromise } from "@highstate/pulumi"

const { name, args, inputs, outputs } = forUnit(nixos.inlineFlake)

const { folders, files } = await toPromise(inputs)

const flakeRepo = await MaterializedRepository.create(args.flakeName ?? name)

let firstOpenBrace = args.code.indexOf("{\n")
if (firstOpenBrace === -1) {
  firstOpenBrace = args.code.indexOf("{")
}

if (firstOpenBrace === -1) {
  throw new Error("The provided code does not contain a valid flake.nix structure.")
}

const codeParts = [args.code.slice(0, firstOpenBrace + 1).trim(), ""]

const hasFlake = async (folder: MaterializedFolder) => {
  try {
    await access(join(folder.path, "flake.nix"))
    return true
  } catch {
    return false
  }
}

for (const inputFolder of folders ?? []) {
  const folder = await MaterializedFolder.open(inputFolder, flakeRepo.folder)

  if (await hasFlake(folder)) {
    codeParts.push(`inputs.${inputFolder.meta.name}.url = "path:./${folder.entity.meta.name}";`)
  }
}

for (const inputFile of files ?? []) {
  await MaterializedFile.open(inputFile, flakeRepo.folder)
}

codeParts.push("", args.code.slice(firstOpenBrace + 1).trim(), "")
const generatedCode = codeParts.join("\n")

await writeFile(join(flakeRepo.path, "flake.nix"), generatedCode)
await flakeRepo.git.add(".")

// format the code with nixfmt
await new Command("format-flake", {
  host: "local",
  create: `nix-shell -p nixfmt-rfc-style --run "nixfmt flake.nix"`,
  cwd: flakeRepo.path,
}).wait()

const formattedCode = await readFile(join(flakeRepo.path, "flake.nix"), "utf-8")

// run nix flake update to generate the lock file and check for errors
await new Command("update-flake", {
  host: "local",
  create: "nix flake update",
  cwd: flakeRepo.path,
}).wait()

const lockContent = await readFile(join(flakeRepo.path, "flake.lock"), "utf-8")

export default outputs({
  folder: flakeRepo.pack(),

  $pages: {
    index: {
      meta: {
        title: "Generated flake.nix",
        description: "The generated flake.nix file from the provided template code.",
        icon: "mdi:file-code",
      },
      content: [
        {
          type: "markdown",
          content: text`
            The following \`flake.nix\` file was generated:

            \`\`\`nix
            ${formattedCode}
            \`\`\`
          `,
        },
        {
          type: "markdown",
          content: text`
            The following inputs were locked:

            \`\`\`nix
            ${lockContent}
            \`\`\`
          `,
        },
      ],
    },
  },
})
