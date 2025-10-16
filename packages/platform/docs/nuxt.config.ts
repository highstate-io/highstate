export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },
  extends: ["docus", "../designer/layers/core"],
  ogImage: { enabled: false },

  modules: ["@vueuse/nuxt"],

  site: {
    name: "Highstate",
  },

  vite: {
    optimizeDeps: {
      include: ["debug"],
    },
  },

  llms: {
    domain: "https://highstate.io",
  },

  typescript: {
    tsConfig: {
      exclude: ["../../designer/layers/**"],
    },
  },
})
