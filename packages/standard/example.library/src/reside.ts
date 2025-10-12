import { defineComponent, z } from "@highstate/contract"
import { k8s } from "@highstate/library"
import { pick } from "remeda"

/**
 * The Reside instance deployed on Kubernetes.
 */
export const reside = defineComponent({
  type: "exeteres.reside.v1",

  args: {
    ...k8s.apps.appName("reside"),

    github: z
      .object({
        repoOwner: z.string().default("exeteres"),
        repoName: z.string().default("reside"),
      })
      .prefault({}),
  },

  inputs: {
    ...pick(k8s.apps.sharedInputs, ["k8sCluster", "mongodb"]),
  },

  create({ name, args, inputs }) {
    k8s.apps.workload({
      name,
      args: {
        appName: args.appName,
        image: "exeteres/reside:latest",

        env: {
          MONGO_USERNAME: {
            dependencyKey: "mongodb.username",
          },
          MONGO_PASSWORD: {
            dependencyKey: "mongodb.password",
          },
          MONGO_DATABASE: {
            dependencyKey: "mongodb.database",
          },

          BOT_TOKEN: {
            secretKey: "botToken",
          },
          GITHUB_TOKEN: {
            secretKey: "githubToken",
          },
          GEMINI_API_KEY: {
            secretKey: "geminiApiKey",
          },

          NODE_ENV: "production",

          GITHUB_REPO_OWNER: args.github.repoOwner,
          GITHUB_REPO_NAME: args.github.repoName,
        },
      },
      inputs,
    })
  },
})
