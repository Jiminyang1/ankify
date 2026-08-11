const MAX_JSON_BODY_BYTES = 4_000_000;

type JsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; error: "invalid_json" | "payload_too_large" };

export async function readJsonBody(
  req: Request,
  maxBytes = MAX_JSON_BODY_BYTES,
): Promise<JsonBodyResult> {
  const declaredLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { ok: false, error: "payload_too_large" };
  }

  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    return { ok: false, error: "payload_too_large" };
  }

  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, error: "invalid_json" };
  }
}
