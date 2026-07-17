import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { JSDOM } from "jsdom";

function loadImagePage() {
  const html = fs.readFileSync(path.resolve("web/sub2api-image.html"), "utf8");
  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:4173/sub2api-image.html",
    runScripts: "outside-only"
  });
  const inlineScript = Array.from(dom.window.document.scripts)
    .find((script) => !script.src && script.textContent.includes("const state ="));
  assert.ok(inlineScript, "image page inline script should exist");
  dom.window.eval(inlineScript.textContent);
  return dom;
}

test("image format and background controls do not change the selected quality", () => {
  const dom = loadImagePage();
  const { document } = dom.window;

  document.querySelector('.format-btn[data-value="webp"]').click();
  assert.equal(document.querySelector("#quality-grid .quality-btn.active")?.dataset.value, "auto");
  assert.equal(document.querySelector("#format-grid .format-btn.active")?.dataset.value, "webp");

  document.querySelector('.background-btn[data-value="transparent"]').click();
  assert.equal(document.querySelector("#quality-grid .quality-btn.active")?.dataset.value, "auto");
  assert.equal(document.querySelector("#format-grid .format-btn.active")?.dataset.value, "webp");
  assert.equal(document.querySelector("#background-grid .background-btn.active")?.dataset.value, "transparent");

  dom.window.close();
});

test("image page keeps unfinished jobs recoverable and accepts dragged or pasted references", () => {
  const html = fs.readFileSync(path.resolve("web/sub2api-image.html"), "utf8");

  assert.match(html, /kw_sub2api_image_pending_job_v1/);
  assert.match(html, /data-action="continue-waiting"/);
  assert.match(html, /restorePendingJob\(\)/);
  assert.match(html, /referenceZone\.addEventListener\("drop"/);
  assert.match(html, /promptInput\.addEventListener\("paste"/);
});
