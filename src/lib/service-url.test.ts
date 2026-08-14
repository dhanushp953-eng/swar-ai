import { describe, expect, it } from "vitest";
import { resolveServiceBaseUrl, stripTrailingSlash } from "./service-url";

function withBrowserHost(hostname: string, run: () => void) {
  const original = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = { location: { hostname } };
  try {
    run();
  } finally {
    if (original === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = original;
    }
  }
}

describe("resolveServiceBaseUrl", () => {
  it("uses the configured URL unchanged when no env is set on a localhost browser", () => {
    withBrowserHost("localhost", () => {
      expect(resolveServiceBaseUrl(undefined)).toBe("http://localhost:8000");
    });
  });

  it("swaps loopback host for the browser LAN hostname on a phone", () => {
    withBrowserHost("192.168.29.53", () => {
      expect(resolveServiceBaseUrl("http://localhost:8000")).toBe("http://192.168.29.53:8000");
    });
  });

  it("builds the analyser POST URL from the resolved LAN host", () => {
    withBrowserHost("192.168.29.53", () => {
      expect(`${resolveServiceBaseUrl("http://localhost:8000")}/api/analyze`).toBe("http://192.168.29.53:8000/api/analyze");
    });
  });

  it("keeps a non-loopback configured host untouched on a LAN browser", () => {
    withBrowserHost("192.168.29.53", () => {
      expect(resolveServiceBaseUrl("http://example.com:8000")).toBe("http://example.com:8000");
    });
  });

  it("does not change an already-LAN configured host", () => {
    withBrowserHost("192.168.29.53", () => {
      expect(resolveServiceBaseUrl("http://192.168.29.53:8000")).toBe("http://192.168.29.53:8000");
    });
  });

  it("leaves the configured URL alone on a desktop localhost browser", () => {
    withBrowserHost("localhost", () => {
      expect(resolveServiceBaseUrl("http://localhost:9000")).toBe("http://localhost:9000");
    });
  });

  it("returns same-origin empty base URL on production domains when unconfigured", () => {
    withBrowserHost("swar-ai-psi.vercel.app", () => {
      expect(resolveServiceBaseUrl(undefined)).toBe("");
      expect(resolveServiceBaseUrl("")).toBe("");
      expect(resolveServiceBaseUrl("/")).toBe("");
    });
  });

  it("strips trailing slashes", () => {
    expect(stripTrailingSlash("http://localhost:8000/")).toBe("http://localhost:8000");
    withBrowserHost("192.168.29.53", () => {
      expect(resolveServiceBaseUrl("http://localhost:8000/")).toBe("http://192.168.29.53:8000");
    });
  });
});
