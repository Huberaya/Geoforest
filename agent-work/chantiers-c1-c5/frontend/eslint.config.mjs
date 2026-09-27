import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "node_modules/**", "next-env.d.ts"]),
  {
    rules: {
      // Les textes français du projet utilisent des apostrophes typographiques et ASCII.
      "react/no-unescaped-entities": "off",
      // Règles React 19 très strictes : le dépôt contient déjà des effets de chargement et refs legacy.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      // Navigation HTML existante dans des écrans non touchés par C7.
      "@next/next/no-html-link-for-pages": "off",
    },
  },
]);
