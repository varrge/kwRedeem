import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(process.argv[2] || "");
const updateLogPath = path.resolve(process.argv[3] || "");

if (!process.argv[2] || !process.argv[3]) {
  console.error("usage: node scripts/update-launcher.js <project-root> <update-log-path>");
  process.exit(2);
}

fs.mkdirSync(path.dirname(updateLogPath), { recursive: true });
const logDescriptor = fs.openSync(updateLogPath, "a", 0o600);

try {
  const child = spawn("bash", ["scripts/update.sh"], {
    cwd: projectRoot,
    env: process.env,
    detached: true,
    stdio: ["ignore", logDescriptor, logDescriptor]
  });
  if (!Number.isInteger(child.pid)) {
    throw new Error("failed to start the detached update process");
  }
  child.unref();
  process.stdout.write(String(child.pid));
} finally {
  fs.closeSync(logDescriptor);
}
