import path from "node:path";

export function buildUpdateProcessEnv({ processEnv = process.env, execPath = process.execPath } = {}) {
  const nodeBinDir = path.dirname(execPath);
  const existingPath = String(processEnv.PATH || "")
    .split(path.delimiter)
    .filter(Boolean)
    .filter((entry) => entry !== nodeBinDir);

  return {
    ...processEnv,
    PATH: [nodeBinDir, ...existingPath].join(path.delimiter)
  };
}
