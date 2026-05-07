import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export type EncryptedSecret = {
  v: 1;
  iv: string;
  ciphertext: string;
};

function encryptionKey() {
  const raw = process.env.AI_KEY_ENCRYPTION_SECRET;
  if (!raw) {
    throw new Error("AI_KEY_ENCRYPTION_SECRET missing");
  }

  const trimmed = raw.trim();
  const bytes = /^[0-9a-f]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : /^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) && Buffer.from(trimmed, "base64").length >= 32
      ? Buffer.from(trimmed, "base64")
      : Buffer.from(trimmed, "utf8");

  return bytes.length === 32 ? bytes : createHash("sha256").update(bytes).digest();
}

export function encryptSecret(value: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    iv: iv.toString("base64url"),
    ciphertext: Buffer.concat([ciphertext, tag]).toString("base64url"),
  };
}

export function decryptSecret(envelope: EncryptedSecret): string {
  if (envelope.v !== 1) throw new Error("unsupported encrypted secret version");
  const payload = Buffer.from(envelope.ciphertext, "base64url");
  if (payload.length < 17) throw new Error("invalid encrypted secret payload");
  const ciphertext = payload.subarray(0, payload.length - 16);
  const tag = payload.subarray(payload.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(envelope.iv, "base64url"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
