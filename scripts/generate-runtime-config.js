import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../shared/src/env.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const config = {
  apiUrl: env.apiUrl
};

const payload = JSON.stringify(config).replaceAll("<", "\\u003c");
const content = `window.KAWANG_CONFIG = Object.freeze(${payload});\n`;

for (const dir of ["web", "admin"]) {
  const filePath = path.join(projectRoot, dir, "runtime-config.js");
  fs.writeFileSync(filePath, content);
  console.log(`Generated ${path.relative(projectRoot, filePath)} with API_URL=${env.apiUrl}`);
}
