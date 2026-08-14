export function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * Resolves a backend service base URL for browser use.
 *
 * When the configured URL points at loopback (localhost / 127.0.0.1) but the
 * browser is itself served from a LAN IP (e.g. a phone hitting the dev machine
 * via http://192.168.x.x:3001), the loopback host would resolve to the phone
 * itself and the request would fail. In that case we swap only the hostname for
 * window.location.hostname, keeping the configured scheme and port.
 */
export function resolveServiceBaseUrl(configured: string | undefined): string {
  const raw = (configured ?? "").trim();
  if (raw === "/" || raw === "") {
    if (typeof window !== "undefined" && window.location && window.location.hostname) {
      const browserHost = window.location.hostname;
      const isLoopback = browserHost === "localhost" || browserHost === "127.0.0.1" || browserHost === "";
      const isLan =
        browserHost.startsWith("192.168.") ||
        browserHost.startsWith("10.") ||
        browserHost.startsWith("172.16.") ||
        browserHost.startsWith("172.17.") ||
        browserHost.startsWith("172.18.") ||
        browserHost.startsWith("172.19.") ||
        browserHost.startsWith("172.2") ||
        browserHost.startsWith("172.3");
      if (!isLoopback && !isLan) {
        return "";
      }
    }
    if (raw === "/") return "";
  }
  const base = raw || "http://localhost:8000";
  if (typeof window === "undefined" || !window.location) {
    return stripTrailingSlash(base);
  }
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return stripTrailingSlash(base);
  }
  const isConfiguredLoopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const browserHost = window.location.hostname;
  const isBrowserLoopback = browserHost === "localhost" || browserHost === "127.0.0.1" || browserHost === "";
  if (isConfiguredLoopback && !isBrowserLoopback && browserHost) {
    url.hostname = browserHost;
  }
  return stripTrailingSlash(url.toString());
}
