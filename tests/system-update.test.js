import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

import { buildUpdateProcessEnv } from "../api/src/system-update.js";

test("online updates prefer the Node binary that is running the API over a stale PM2 PATH", () => {
  const env = buildUpdateProcessEnv({
    processEnv: {
      PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      KEEP_ME: "yes"
    },
    execPath: "/root/.nvm/versions/node/v20.20.2/bin/node"
  });

  assert.equal(
    env.PATH,
    "/root/.nvm/versions/node/v20.20.2/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
  );
  assert.equal(env.KEEP_ME, "yes");
});

test("online update PATH does not duplicate the API Node binary directory", () => {
  const env = buildUpdateProcessEnv({
    processEnv: {
      PATH: "/root/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin"
    },
    execPath: "/root/.nvm/versions/node/v20.20.2/bin/node"
  });

  assert.equal(env.PATH, "/root/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin");
});

test("online update environment resolves node to the same runtime as the API", () => {
  const env = buildUpdateProcessEnv({
    processEnv: { PATH: "/usr/bin:/bin" },
    execPath: process.execPath
  });

  const childVersion = execFileSync("node", ["-v"], { env, encoding: "utf8" }).trim();
  assert.equal(childVersion, process.version);
});
