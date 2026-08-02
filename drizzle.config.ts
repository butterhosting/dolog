import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  out: "./src/drizzle/migrations",
  schema: "./src/drizzle/schema.ts",
});
