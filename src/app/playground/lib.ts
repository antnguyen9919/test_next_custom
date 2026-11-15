// Browser-side helpers. Every URL is relative to the page's own origin: the
// gateway routes /hono/* and /py/* on the same host, so there's no CORS and no
// service hostnames in client code.
export function wsUrl(path: string) {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${path}`;
}

export function stamp() {
  return new Date().toLocaleTimeString();
}
