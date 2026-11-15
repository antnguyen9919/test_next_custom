import Link from "next/link";

const nextLinks = [
  { href: "/playground", note: "Next ↔ Node ↔ Python: SSE, WebSocket, fetch, server action" },
  { href: "/static", note: "Prerendered at build time" },
  { href: "/dynamic", note: "Reads request headers, streams after 1.5s" },
  { href: "/cached", note: "'use cache' + cacheTag, on-demand revalidation" },
  { href: "/actions", note: "Server Action form" },
  { href: "/image", note: "next/image optimization" },
  { href: "/api/time", note: "Next route handler" },
  { href: "/proxy-redirect", note: "Redirect done by src/proxy.ts" },
];

// Not Next routes: plain <a> so Next doesn't prefetch them as RSC requests.
const serviceLinks = [
  { href: "/hono", note: "Node service (Hono), routed by the gateway" },
  { href: "/py/docs", note: "Python service (FastAPI) docs, routed by the gateway" },
];

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-2xl p-8 font-sans">
      <h1 className="text-2xl font-semibold">Next.js + Node + Python behind one gateway</h1>
      <h2 className="mt-6 font-semibold">Next routes</h2>
      <ul className="mt-2 space-y-2">
        {nextLinks.map((l) => (
          <li key={l.href}>
            <Link className="font-mono underline" href={l.href}>{l.href}</Link>{" "}
            <span className="text-zinc-500">— {l.note}</span>
          </li>
        ))}
      </ul>
      <h2 className="mt-6 font-semibold">Other services (same origin)</h2>
      <ul className="mt-2 space-y-2">
        {serviceLinks.map((l) => (
          <li key={l.href}>
            <a className="font-mono underline" href={l.href}>{l.href}</a>{" "}
            <span className="text-zinc-500">— {l.note}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
