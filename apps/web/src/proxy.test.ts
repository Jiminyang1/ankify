import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

const extensionOrigin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
const originalOrigins = process.env.ANKIFY_EXTENSION_ORIGINS;
const originalProfile = process.env.ANKIFY_PROFILE;

afterEach(() => {
  if (originalOrigins === undefined) {
    delete process.env.ANKIFY_EXTENSION_ORIGINS;
  } else {
    process.env.ANKIFY_EXTENSION_ORIGINS = originalOrigins;
  }
  if (originalProfile === undefined) {
    delete process.env.ANKIFY_PROFILE;
  } else {
    process.env.ANKIFY_PROFILE = originalProfile;
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

  it("lets Vercel Queue callbacks reach the queue SDK without a user cookie", async () => {
    const response = await proxy(
      new NextRequest("https://ankify.example.com/api/queues/ai-generation", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
  });

  it("opens the fixed-session login only in the QA profile", async () => {
    process.env.ANKIFY_PROFILE = "qa";
    const qaResponse = await proxy(
      new NextRequest("http://localhost:3000/api/qa/login"),
    );
    expect(qaResponse.status).toBe(200);

    process.env.ANKIFY_PROFILE = "local";
    const localResponse = await proxy(
      new NextRequest("http://localhost:3000/api/qa/login"),
    );
    expect(localResponse.status).toBe(401);
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
