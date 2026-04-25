// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },
  telemetry: false,

  typescript: {
    tsConfig: {
      compilerOptions: {
        allowImportingTsExtensions: true,
        noUncheckedIndexedAccess: false
      },
    },
  },

  nitro: {
    typescript: {
      tsConfig: {
        compilerOptions: {
          allowImportingTsExtensions: true,
          noUncheckedIndexedAccess: false
        },
      },
    },
  },

  css: ["vuetify/styles", "#layers/core/app/assets/main.css"],

  extends: ["./layers/core"],
})

// hi23
