import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
// Next standalone may copy local dotenv files through tracing. Never ship those.
const root = ".next/standalone";
if (!existsSync(root)) throw new Error("Standalone build missing");
for (const file of readdirSync(root))
  if (file === ".env" || file.startsWith(".env."))
    rmSync(`${root}/${file}`, { force: true });
cpSync(".next/static", `${root}/.next/static`, { recursive: true });
if (existsSync("public"))
  cpSync("public", `${root}/public`, { recursive: true });
console.log("Standalone ready; dotenv files removed from artifact.");
