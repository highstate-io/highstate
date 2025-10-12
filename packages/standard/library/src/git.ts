import { defineUnit, z } from "@highstate/contract"
import { folderEntity } from "./common/files"
import { l7EndpointEntity } from "./network"

/**
 * References a remote Git repository.
 *
 * The repository will be cloned or fetched from the specified URL and the content will be packed into a folder.
 */
export const remoteRepository = defineUnit({
  type: "git.remote-repository.v1",

  args: {
    /**
     * The URL of the remote repository.
     */
    url: z.string().optional(),

    /**
     * The ref of the remote repository to checkout.
     *
     * If not specified, the default branch will be used.
     */
    ref: z.string().optional(),

    /**
     * Whether to include the .git directory in the packed artifact.
     *
     * Do not enable this unless you need the full git history.
     */
    includeGit: z.boolean().default(false),
  },

  inputs: {
    /**
     * The L7 endpoint of the remote repository.
     */
    endpoint: {
      entity: l7EndpointEntity,
      required: false,
    },
  },

  outputs: {
    /**
     * The folder containing the repository content.
     */
    folder: folderEntity,
  },

  meta: {
    title: "Git Remote Repository",
    icon: "simple-icons:git",
    iconColor: "#f1502f",
    category: "Git",
  },

  source: {
    package: "@highstate/git",
    path: "remote-repository",
  },
})
