import { describe, expect, it } from "vitest";
import nextConfig from "./next.config";

describe("next.config security headers", () => {
  it("applies defensive headers to every path", async () => {
    const headers = await nextConfig.headers!();
    const match = headers.find((entry) => entry.source === "/:path*");
    expect(match).toBeDefined();
    const map = Object.fromEntries(match!.headers.map((header) => [header.key.toLowerCase(), header.value]));
    expect(map["x-content-type-options"]).toBe("nosniff");
    expect(map["x-frame-options"]).toBe("DENY");
    expect(map["referrer-policy"]).toBe("no-referrer");
    expect(map["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(map["content-security-policy"]).toContain("default-src 'self'");
  });
});
