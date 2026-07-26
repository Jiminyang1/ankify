import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

const extensionOrigin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
const originalOrigins = process.env.ANKIFY_EXTENSION_ORIGINS;

afterEach(() => {
  if (originalOrigins === undefined) {
    delete process.env.ANKIFY_EXTENSION_ORIGINS;
  } else {
    process.env.ANKIFY_EXTENSION_ORIGINS = originalOrigins;
  }
});

describe("extension session CORS", () => {
  it("keeps the product homepage public for Google OAuth verification", async () => {
    const response = await proxy(
      new NextRequest("https://ankify.example.com/"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.has("location")).toBe(false);
  });

  it("keeps the extension welcome page public before sign-in", async () => {
    const response = await proxy(
      new NextRequest("https://ankify.example.com/welcome?source=extension"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.has("location")).toBe(false);
  });

  it("allows credentialed preflight only for configured extension origins", async () => {
    process.env.ANKIFY_EXTENSION_ORIGINS = extensionOrigin;
    const response = await proxy(
      new NextRequest("https://ankify.example.com/api/capture", {
        method: "OPTIONS",
        headers: { origin: extensionOrigin },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(extensionOrigin);
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.get("access-control-allow-headers")).toBe("Content-Type");
  });

  it("does not let retired x-ankify-token headers bypass session auth", async () => {
    process.env.ANKIFY_EXTENSION_ORIGINS = extensionOrigin;
    const response = await proxy(
      new NextRequest("https://ankify.example.com/api/me", {
        headers: {
          origin: extensionOrigin,
          "x-ankify-token": "retired-token",
        },
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("does not grant CORS to an untrusted extension", async () => {
    process.env.ANKIFY_EXTENSION_ORIGINS = extensionOrigin;
    const response = await proxy(
      new NextRequest("https://ankify.example.com/api/me", {
        headers: {
          origin: "chrome-extension://pppppppppppppppppppppppppppppppp",
        },
      }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
    expect(response.headers.has("access-control-allow-credentials")).toBe(false);
  });
});
