import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  // Le propriétaire de la base (pas le rôle applicatif) : les migrations
  // doivent pouvoir modifier le schéma sans être filtrées par la RLS.
  dbCredentials: {
    url: process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL ?? "",
  },
});
