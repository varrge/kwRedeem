import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

for (const page of ["sub2api-invites.html", "sub2api-subscriptions.html"]) {
  test(`${page} only suggests same-origin access when browser auth is unavailable`, () => {
    const html = fs.readFileSync(new URL(`../web/${page}`, import.meta.url), "utf8");

    assert.match(
      html,
      /const sameOriginHint = connectionId && !sso && !accessToken && !refreshToken/
    );
  });
}
