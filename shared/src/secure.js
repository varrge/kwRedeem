import crypto from "node:crypto";
import { env } from "./env.js";

function getKey() {
  return crypto.createHash("sha256").update(env.jwtSecret).digest();
}

// Only call with an identity returned by the provider's authenticated preflight.
export function automationAccountKey(providerId, identity) {
  const value = String(identity || "").trim().toLowerCase();
  if (!value || value.includes("*") || value.length > 320) return null;
  return crypto.createHmac("sha256", getKey())
    .update(JSON.stringify(["automation-account-v1", String(providerId), value])).digest("hex");
}

export function encryptText(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptText(value) {
  if (!value) return "";

  const [ivHex, tagHex, contentHex] = String(value).split(":");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getKey(),
    Buffer.from(ivHex, "hex")
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(contentHex, "hex")),
    decipher.final()
  ]);
  return decrypted.toString("utf8");
}
