import { defineUnit, z } from "@highstate/contract"
import { fileEntity, folderEntity } from "./common/files"
import { serverEntity } from "./common/server"

/**
 * Creates a NixOS module from inline code.
 */
export const inlineModule = defineUnit({
  type: "nixos.inline-module.v1",

  args: {
    /**
     * The name of the module file.
     *
     * If not provided, the name will be the name of the unit.
     */
    moduleName: z.string().optional(),

    /**
     * The code of the NixOS module.
     *
     * In this code you can reference other modules and files by their names.
     */
    code: z.string().meta({ language: "nix" }),
  },

  inputs: {
    files: {
      entity: fileEntity,
      required: false,
      multiple: true,
    },
    folders: {
      entity: folderEntity,
      required: false,
      multiple: true,
    },
  },

  outputs: {
    folder: folderEntity,
  },

  meta: {
    title: "NixOS Inline Module",
    icon: "simple-icons:nixos",
    iconColor: "#7ebae4",
    secondaryIcon: "mdi:file-code",
    category: "NixOS",
  },

  source: {
    package: "@highstate/nixos",
    path: "inline-module",
  },
})

/**
 * Creates a NixOS flake from inline code.
 *
 * This unit allows you to define a NixOS flake directly in the unit code.
 * It can reference other flakes, modules, files, and folders by their names.
 */
export const inlineFlake = defineUnit({
  type: "nixos.inline-flake.v1",

  args: {
    /**
     * The name of the flake folder.
     *
     * If not provided, the name will be the name of the unit.
     */
    flakeName: z.string().optional(),

    /**
     * The code of the `flake.nix` file.
     *
     * In this code you can reference other flakes, modules, files, and folders by their names.
     * The inputs for them will be automatically added to the `inputs` attribute of the flake.
     *
     * You can run this component to see the generated `flake.nix` file in pages.
     */
    code: z.string().meta({ language: "nix" }),
  },

  inputs: {
    files: {
      entity: fileEntity,
      required: false,
      multiple: true,
    },
    folders: {
      entity: folderEntity,
      required: false,
      multiple: true,
    },
  },

  outputs: {
    folder: folderEntity,
  },

  meta: {
    title: "NixOS Inline Flake",
    icon: "simple-icons:nixos",
    iconColor: "#7ebae4",
    secondaryIcon: "mdi:file-code",
    category: "NixOS",
  },

  source: {
    package: "@highstate/nixos",
    path: "inline-flake",
  },
})

/**
 * Creates a NixOS system on top of any server.
 *
 * This unit allows you to define a NixOS system configuration that will be applied to the server.
 * It can reference other modules, files, and folders by their names.
 *
 * To create a NixOS system, it will use `nixos-anywhere` which will use kexec
 * to boot into the new kernel to install NixOS.
 */
export const system = defineUnit({
  type: "nixos.system.v1",

  args: {
    system: z.string().optional(),
  },

  inputs: {
    server: serverEntity,
    flake: folderEntity,
  },

  outputs: {
    server: serverEntity,
  },

  meta: {
    title: "NixOS System",
    icon: "simple-icons:nixos",
    iconColor: "#7ebae4",
    secondaryIcon: "codicon:vm",
    category: "NixOS",
  },

  source: {
    package: "@highstate/nixos",
    path: "system",
  },
})
