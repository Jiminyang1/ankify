import { createHash } from "node:crypto";

/** JSON with object keys sorted recursively and undefined members dropped, so
 *  semantically equal payloads serialize identically. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item ?? null)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** SHA-256 of a command's validated payload (without its request id). A replay
 *  must match it exactly; a changed payload under the same id is a conflict. */
export function payloadDigest(payload: unknown) {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}
