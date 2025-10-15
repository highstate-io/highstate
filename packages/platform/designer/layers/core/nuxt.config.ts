import { resolve } from "node:path"
import { version } from "../../package.json"

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },
  telemetry: false,

  $meta: {
    name: "core",
  },

  modules: [
    "vuetify-nuxt-module",
    "@pinia/nuxt",
    "@vueuse/nuxt",
    // "@nuxtjs/i18n",
  ],

  typescript: {
    tsConfig: {
      compilerOptions: {
        noUncheckedIndexedAccess: false,
      },
    },
  },
  experimental: {
    typedPages: true,
  },
  build: {
    transpile: ["trpc-nuxt"],
  },
  imports: {
    dirs: ["./utils", "./stores/**"],
  },
  alias: {
    // bundle shared code to the frontend
    "@highstate/backend/shared": resolve(
      import.meta.dirname,
      "../../node_modules/@highstate/backend/src/shared/index.ts",
    ),
  },
  nitro: {
    inlineDynamicImports: true,
    experimental: {
      websocket: true,
    },
  },
  ssr: false,
  vuetify: {
    moduleOptions: {
      disableVuetifyStyles: true,
    },
    vuetifyOptions: {
      theme: {
        defaultTheme: "dark",
      },
      icons: {
        defaultSet: "mdi",
        sets: ["mdi"],
      },
    },
  },

  $development: {
    alias: {
      // for HMR
      "@highstate/backend": resolve(
        import.meta.dirname,
        "../../node_modules/@highstate/backend/src/index.ts",
      ),
      "@highstate/backend-api": resolve(
        import.meta.dirname,
        "../../node_modules/@highstate/backend-api/src/index.ts",
      ),
    },
  },

  vite: {
    server: {
      allowedHosts: process.env.NUXT_ALLOWED_HOSTS?.split(","),
    },

    build: {
      target: "esnext",

      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules/shiki")) {
              return "shiki"
            }

            if (id.includes("node_modules/monaco-editor")) {
              return "monaco-editor"
            }

            if (id.includes("vuetify")) {
              return "vuetify"
            }
          },
        },
      },
    },

    worker: {
      format: "es",
    },
  },

  runtimeConfig: {
    public: {
      version,
      eventsPort: 3002,
    },
  },

  $production: {
    nitro: {
      rollupConfig: {
        external(source) {
          return source.startsWith("@highstate/")
        },
      },
    },
  },
})
