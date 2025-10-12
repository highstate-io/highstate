export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },
  extends: ["docus", "../designer/layers/core"],
  ogImage: { enabled: false },

  site: {
    name: "Highstate",
  },

  vite: {
    optimizeDeps: {
      include: ["debug"],
    },
  },

  typescript: {
    tsConfig: {
      exclude: ["../../designer/layers/**"],
    },
  },
})
