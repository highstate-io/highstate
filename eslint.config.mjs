import jsdoc from "eslint-plugin-jsdoc"
import tseslint from "typescript-eslint"
import vueParser from "vue-eslint-parser"
import highstate from "./scripts/style/plugin.mjs"

const files = ["packages/**/*.ts", "packages/**/*.vue", "scripts/**/*.{ts,mjs}", "*.{ts,mjs}"]

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.nuxt/**",
      "**/.output/**",
      "**/.nx/**",
      "**/coverage/**",
      "**/generated/**",
      "**/_generated/**",
      "packages/platform/designer/layers/core/app/workers/libavoid/**",
      "packages/platform/docs/docus/**",
      "packages/platform/cli/assets/template/**",
      "packages/standard/k8s.dashboard-worker/plugin/**",
    ],
  },
  {
    files,
    languageOptions: { parser: tseslint.parser },
    plugins: { highstate, jsdoc },
    settings: { jsdoc: { mode: "typescript" } },
    rules: {
      ...Object.fromEntries(
        Object.keys(highstate.rules).map(name => [`highstate/${name}`, "error"]),
      ),
      "jsdoc/check-alignment": "error",
      "jsdoc/check-tag-names": ["error", { definedTags: ["internal", "template", "default"] }],
      "jsdoc/require-hyphen-before-param-description": ["error", "never"],
      "jsdoc/tag-lines": ["error", "any", { startLines: 1 }],
      "jsdoc/multiline-blocks": ["error", { noSingleLineBlocks: true }],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@highstate/*/src/**", "@highstate/*/dist/**", "@highstate/*/generated/**"],
              message:
                "Import the supported package entry point and export missing APIs from its barrel.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.vue"],
    languageOptions: {
      parser: vueParser,
      parserOptions: { parser: tseslint.parser, extraFileExtensions: [".vue"] },
    },
  },
  ...(process.env.HIGHSTATE_TYPED_LINT === "true"
    ? [
        {
          files: ["packages/*/*/src/**/*.ts"],
          languageOptions: {
            parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
          },
          plugins: { "@typescript-eslint": tseslint.plugin },
          rules: { "@typescript-eslint/return-await": ["error", "always"] },
        },
      ]
    : []),
]
