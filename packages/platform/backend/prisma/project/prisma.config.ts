import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: ".",
  migrations: {
    path: "migrations",
  },
  datasource: {
    url: "highstate-project.db",
  },
});
