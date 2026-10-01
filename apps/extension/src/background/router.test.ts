import { describe, expect, it } from "vitest";
import { apiFailure } from "./router";

describe("API failures as the popup and panel see them", () => {
  it("tells sign-out, outage, overload, and server decisions apart", () => {
    expect(apiFailure({ ok: false, kind: "auth", status: 401 })).toEqual({ ok: false, error: "signed_out" });
    expect(apiFailure({ ok: false, kind: "network", status: null })).toEqual({ ok: false, error: "offline" });
    expect(apiFailure({ ok: false, kind: "server", status: 503 })).toEqual({ ok: false, error: "server_error" });
    expect(apiFailure({ ok: false, kind: "rate_limited", status: 429 })).toEqual({ ok: false, error: "rate_limited" });
    expect(apiFailure({ ok: false, kind: "rejected", status: 409, code: "problem_limit_reached" })).toEqual({ ok: false, error: "problem_limit_reached" });
    expect(apiFailure({ ok: false, kind: "rejected", status: 400 })).toEqual({ ok: false, error: "unexpected" });
  });
});
