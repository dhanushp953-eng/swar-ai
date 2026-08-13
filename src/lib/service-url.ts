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
  const base = (configured ?? "").trim() || "http://localhost:8000";
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
