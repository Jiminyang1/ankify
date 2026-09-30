/**
 * Authenticated backend client for trusted extension contexts. It reuses the
 * web session cookie (`credentials: include`) and classifies every failure so
 * callers can decide between retrying, pausing for sign-in, and giving up.
 */

export type ApiFailureKind =
  /** 401: the Ankify session is missing or expired; pause and ask to sign in. */
  | "auth"
  /** 429: retry after the server's delay. */
  | "rate_limited"
  /** No response (offline, DNS, timeout). Retry. */
  | "network"
  /** 5xx (including a workflow switched off). Retry with backoff. */
  | "server"
  /** Any other 4xx: the server decided; retrying the same request cannot help. */
  | "rejected";

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | {
      ok: false;
      kind: ApiFailureKind;
      status: number | null;
      /** The `error` code from the JSON body, when present. */
      code?: string;
      retryAfterMs?: number;
      body?: unknown;
    };

export const OWNER_TOKEN_HEADER = "X-Ankify-Owner-Token";
const DEFAULT_TIMEOUT_MS = 20_000;

export type ApiRequest = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Identifies the tab controlling a practice session. */
  ownerToken?: string | null;
  timeoutMs?: number;
};

export type ApiClient = {
  origin: string;
  request<T>(path: string, init?: ApiRequest): Promise<ApiResult<T>>;
};

export function createApiClient(options: { origin: string; fetch?: typeof fetch }): ApiClient {
  const origin = options.origin.replace(/\/+$/, "");
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));

  async function request<T>(path: string, init: ApiRequest = {}): Promise<ApiResult<T>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), init.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    let response: Response;
    try {
      response = await doFetch(`${origin}${path}`, {
        method: init.method ?? (init.body === undefined ? "GET" : "POST"),
        credentials: "include",
        cache: "no-store",
        headers: {
          ...(init.body === undefined ? {} : { "content-type": "application/json" }),
          ...(init.ownerToken ? { [OWNER_TOKEN_HEADER]: init.ownerToken } : {}),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal: controller.signal,
      });
    } catch {
      return { ok: false, kind: "network", status: null };
    } finally {
      clearTimeout(timeout);
    }

    const body: unknown = await response.json().catch(() => null);
    if (response.ok) return { ok: true, status: response.status, data: body as T };
    const code = typeof (body as { error?: unknown } | null)?.error === "string" ? (body as { error: string }).error : undefined;
    if (response.status === 401) return { ok: false, kind: "auth", status: 401, code, body };
    if (response.status === 429) {
      return { ok: false, kind: "rate_limited", status: 429, code, body, retryAfterMs: retryAfterMs(response, body) };
    }
    if (response.status === 408 || response.status >= 500) {
      return { ok: false, kind: response.status === 408 ? "network" : "server", status: response.status, code, body };
    }
    return { ok: false, kind: "rejected", status: response.status, code, body };
  }

  return { origin, request };
}

function retryAfterMs(response: Response, body: unknown) {
  const header = Number(response.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return header * 1000;
  const seconds = (body as { retryAfterSec?: unknown } | null)?.retryAfterSec;
  return typeof seconds === "number" && seconds > 0 ? seconds * 1000 : undefined;
}
