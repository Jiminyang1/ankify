import { describe, expect, it } from "vitest";
import { readJsonBody } from "./request-body";

describe("readJsonBody", () => {
  it("parses JSON below the byte limit", async () => {
    const result = await readJsonBody(
      new Request("https://example.test", {
        method: "POST",
        body: JSON.stringify({ ok: true }),
      }),
      100,
    );

    expect(result).toEqual({ ok: true, value: { ok: true } });
  });

  it("measures UTF-8 bytes rather than JavaScript string length", async () => {
    const result = await readJsonBody(
      new Request("https://example.test", {
        method: "POST",
        body: JSON.stringify({ value: "你你你" }),
      }),
      20,
    );

    expect(result).toEqual({ ok: false, error: "payload_too_large" });
  });

  it("rejects an oversized declared content length before parsing", async () => {
    const result = await readJsonBody(
      new Request("https://example.test", {
        method: "POST",
        headers: { "content-length": "101" },
        body: "{}",
      }),
      100,
    );

    expect(result).toEqual({ ok: false, error: "payload_too_large" });
  });

  it("reports malformed JSON without throwing", async () => {
    const result = await readJsonBody(
      new Request("https://example.test", { method: "POST", body: "{" }),
      100,
    );

    expect(result).toEqual({ ok: false, error: "invalid_json" });
  });
});
