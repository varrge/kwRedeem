import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kawang-sub2api-image-api-"));
process.env.DATABASE_PATH = path.join(tmpDir, "test.db");
process.env.JWT_SECRET = "sub2api-image-api-secret";
process.env.ADMIN_USERNAME = "admin";
process.env.ADMIN_PASSWORD = "test-password";
process.env.KAWANG_SKIP_LISTEN = "1";

let upstream;
let upstreamBaseUrl;
const upstreamRequests = [];
let transientGenerationFailures = 0;
let transientEditFailures = 0;
let transientNetworkFailures = 0;

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

before(async () => {
  upstream = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      upstreamRequests.push({ method: request.method, url: request.url, body });

      if (request.method === "GET" && request.url === "/api/v1/auth/me") {
        sendJson(response, 200, {
          code: 0,
          data: { id: 77, email: "image@example.com", username: "image-user" }
        });
        return;
      }
      if (request.method === "GET" && request.url === "/api/v1/keys") {
        sendJson(response, 200, {
          code: 0,
          data: {
            items: [
              {
                id: 1,
                key: "sk-no-image-permission",
                name: "普通 Key",
                status: "active",
                group: { id: 10, name: "文本分组", allow_image_generation: false }
              },
              {
                id: 2,
                key: "sk-image-enabled",
                name: "生图 Key",
                status: "active",
                group: { id: 11, name: "生图分组", allow_image_generation: true }
              }
            ]
          }
        });
        return;
      }
      if (request.method === "POST" && request.url === "/v1/images/generations") {
        const payload = JSON.parse(body || "{}");
        if (payload.prompt === "retry a dropped connection" && transientNetworkFailures < 1) {
          transientNetworkFailures += 1;
          request.socket.destroy();
          return;
        }
        if (payload.prompt === "retry a transient failure" && transientGenerationFailures < 1) {
          transientGenerationFailures += 1;
          response.setHeader("Retry-After", "0");
          sendJson(response, 503, { error: { message: "temporary image capacity" } });
          return;
        }
        if (payload.prompt === "use responses fallback") {
          sendJson(response, 404, { error: { message: "images endpoint not found" } });
          return;
        }
        if (payload.prompt === "permanent bad request") {
          sendJson(response, 400, { error: { message: "invalid image request" } });
          return;
        }
        sendJson(response, 200, { data: [{ b64_json: Buffer.from("image").toString("base64") }] });
        return;
      }
      if (request.method === "POST" && request.url === "/v1/images/edits") {
        if (transientEditFailures < 1) {
          transientEditFailures += 1;
          response.setHeader("Retry-After", "0");
          sendJson(response, 503, { error: { message: "temporary edit capacity" } });
          return;
        }
        sendJson(response, 200, { data: [{ b64_json: Buffer.from("edited-image").toString("base64") }] });
        return;
      }
      if (request.method === "POST" && request.url === "/v1/responses") {
        sendJson(response, 200, {
          output: [
            { type: "image_generation_call", result: Buffer.from("image-one").toString("base64") },
            { type: "image_generation_call", result: Buffer.from("image-two").toString("base64") }
          ]
        });
        return;
      }
      sendJson(response, 404, { error: { message: "not found" } });
    });
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address();
  upstreamBaseUrl = `http://127.0.0.1:${address.port}`;
});

const { app } = await import("../api/src/server.js");

after(async () => {
  await app.close();
  await new Promise((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve()));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function createImageSession() {
  const login = await app.inject({
    method: "POST",
    url: "/api/admin/auth/login",
    payload: { username: "admin", password: "test-password" }
  });
  assert.equal(login.statusCode, 200);

  const connection = await app.inject({
    method: "POST",
    url: "/api/admin/sub2api/connections",
    headers: { authorization: `Bearer ${login.json().token}` },
    payload: {
      name: "Image test upstream",
      baseUrl: upstreamBaseUrl,
      adminToken: "remote-admin-token"
    }
  });
  assert.equal(connection.statusCode, 200);

  const session = await app.inject({
    method: "POST",
    url: "/api/public/sub2api/image/session-from-token",
    payload: {
      connectionId: connection.json().item.id,
      accessToken: "remote-user-token"
    }
  });
  assert.equal(session.statusCode, 200);
  return { authorization: `Bearer ${session.json().sessionToken}` };
}

let imageHeaders;

test("image bootstrap only exposes keys whose group allows image generation", async () => {
  imageHeaders ||= await createImageSession();
  const bootstrap = await app.inject({
    method: "GET",
    url: "/api/public/sub2api/image/bootstrap",
    headers: imageHeaders
  });

  assert.equal(bootstrap.statusCode, 200);
  assert.deepEqual(bootstrap.json().keys.map((key) => key.id), ["2"]);
});

test("gpt-image-2 rejects transparent backgrounds before creating a job", async () => {
  imageHeaders ||= await createImageSession();
  upstreamRequests.length = 0;
  const generation = await app.inject({
    method: "POST",
    url: "/api/public/sub2api/image/jobs",
    headers: imageHeaders,
    payload: {
      mode: "text",
      keyId: "2",
      prompt: "draw a diagnostic square",
      model: "gpt-image-2",
      background: "transparent"
    }
  });

  assert.equal(generation.statusCode, 400);
  assert.match(generation.json().message, /gpt-image-2.*不支持透明背景/);
  assert.equal(upstreamRequests.some((item) => item.url === "/v1/images/generations"), false);
});

test("gpt-image-1.5 supports reference image edits", async () => {
  imageHeaders ||= await createImageSession();
  transientEditFailures = 0;
  upstreamRequests.length = 0;
  const generation = await app.inject({
    method: "POST",
    url: "/api/public/sub2api/image/generate",
    headers: imageHeaders,
    payload: {
      mode: "image",
      keyId: "2",
      prompt: "edit the reference image",
      model: "gpt-image-1.5",
      referenceImages: [`data:image/png;base64,${Buffer.from("reference").toString("base64")}`]
    }
  });

  assert.equal(generation.statusCode, 200);
  assert.equal(generation.json().images.length, 1);
  assert.equal(upstreamRequests.filter((item) => item.url === "/v1/images/edits").length, 2);
});

test("transparent backgrounds reject JPEG output before creating a job", async () => {
  imageHeaders ||= await createImageSession();
  upstreamRequests.length = 0;
  const generation = await app.inject({
    method: "POST",
    url: "/api/public/sub2api/image/jobs",
    headers: imageHeaders,
    payload: {
      mode: "text",
      keyId: "2",
      prompt: "draw a transparent diagnostic square",
      model: "gpt-image-1.5",
      background: "transparent",
      outputFormat: "jpeg"
    }
  });

  assert.equal(generation.statusCode, 400);
  assert.match(generation.json().message, /透明背景只支持 PNG 或 WebP/);
  assert.equal(upstreamRequests.some((item) => item.url === "/v1/images/generations"), false);
});

test("image generation retries a transient upstream failure", async () => {
  imageHeaders ||= await createImageSession();
  transientGenerationFailures = 0;
  upstreamRequests.length = 0;
  const generation = await app.inject({
    method: "POST",
    url: "/api/public/sub2api/image/generate",
    headers: imageHeaders,
    payload: {
      mode: "text",
      keyId: "2",
      prompt: "retry a transient failure",
      model: "gpt-image-2"
    }
  });

  assert.equal(generation.statusCode, 200);
  assert.equal(generation.json().images.length, 1);
  assert.equal(upstreamRequests.filter((item) => item.url === "/v1/images/generations").length, 2);
});

test("image generation retries a dropped upstream connection", async () => {
  imageHeaders ||= await createImageSession();
  transientNetworkFailures = 0;
  upstreamRequests.length = 0;
  const generation = await app.inject({
    method: "POST",
    url: "/api/public/sub2api/image/generate",
    headers: imageHeaders,
    payload: {
      mode: "text",
      keyId: "2",
      prompt: "retry a dropped connection",
      model: "gpt-image-1.5"
    }
  });

  assert.equal(generation.statusCode, 200);
  assert.equal(generation.json().images.length, 1);
  assert.equal(upstreamRequests.filter((item) => item.url === "/v1/images/generations").length, 2);
});

test("Responses fallback preserves every returned image", async () => {
  imageHeaders ||= await createImageSession();
  upstreamRequests.length = 0;
  const generation = await app.inject({
    method: "POST",
    url: "/api/public/sub2api/image/generate",
    headers: imageHeaders,
    payload: {
      mode: "text",
      keyId: "2",
      prompt: "use responses fallback",
      model: "gpt-image-2",
      count: 2
    }
  });

  assert.equal(generation.statusCode, 200);
  assert.equal(generation.json().images.length, 2);
  assert.equal(upstreamRequests.filter((item) => item.url === "/v1/responses").length, 1);
});

test("image generation does not retry permanent client errors", async () => {
  imageHeaders ||= await createImageSession();
  upstreamRequests.length = 0;
  const generation = await app.inject({
    method: "POST",
    url: "/api/public/sub2api/image/generate",
    headers: imageHeaders,
    payload: {
      mode: "text",
      keyId: "2",
      prompt: "permanent bad request",
      model: "gpt-image-2"
    }
  });

  assert.equal(generation.statusCode, 502);
  assert.match(generation.json().message, /invalid image request/);
  assert.equal(upstreamRequests.filter((item) => item.url === "/v1/images/generations").length, 1);
});
