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

test("image page removes format and background controls and keeps quality in advanced settings", () => {
  const dom = loadImagePage();
  const { document } = dom.window;

  assert.equal(document.querySelector("#format-grid"), null);
  assert.equal(document.querySelector("#background-grid"), null);
  assert.ok(document.querySelector(".advanced-settings"));
  assert.equal(document.querySelector("#quality-grid .quality-btn.active")?.dataset.value, "auto");
  document.querySelector('#quality-grid .quality-btn[data-value="high"]').click();
  assert.equal(document.querySelector("#quality-summary").textContent, "清晰度：高");

  const source = Array.from(document.scripts)
    .find((script) => !script.src && script.textContent.includes("const state ="))
    ?.textContent || "";
  const requestBody = source.match(/body: JSON\.stringify\(\{([\s\S]*?)referenceImages:/)?.[1] || "";
  assert.doesNotMatch(requestBody, /outputFormat|background/);

  dom.window.close();
});

test("creator tabs separate text, reference editing, and history views", () => {
  const dom = loadImagePage();
  const { document } = dom.window;
  const model = document.querySelector("#model-select");

  model.value = "gpt-image-1.5";
  model.dispatchEvent(new dom.window.Event("change"));
  document.querySelector('[data-mode="image"]').click();
  assert.equal(model.value, "gpt-image-1.5");
  assert.equal(model.selectedOptions[0].disabled, false);
  assert.equal(document.querySelector("#reference-zone").classList.contains("active"), true);

  document.querySelector('[data-mode="history"]').click();
  assert.equal(document.querySelector("#creator-view").classList.contains("hidden"), true);
  assert.equal(document.querySelector("#history-view").classList.contains("hidden"), false);
  assert.equal(document.querySelector('[data-mode="history"]').getAttribute("aria-selected"), "true");

  document.querySelector('[data-mode="text"]').click();
  assert.equal(document.querySelector("#creator-view").classList.contains("hidden"), false);
  assert.equal(document.querySelector("#history-view").classList.contains("hidden"), true);
  assert.equal(document.querySelector("#reference-zone").classList.contains("active"), false);

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
