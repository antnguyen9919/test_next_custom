"use client";

import { useState } from "react";
import { Panel, btn } from "./panel";

type Who = Record<string, string | null>;

/** Plain fetch() from the browser to both services, with relative URLs. */
export function SameOriginFetch() {
  const [results, setResults] = useState<{ path: string; status: number; who: Who }[]>([]);
  const [origin, setOrigin] = useState("");

  const run = async () => {
    setOrigin(window.location.origin);
    const out = [];
    for (const path of ["/hono/whoami", "/py/whoami", "/hono/calls-py"]) {
      const r = await fetch(path, { cache: "no-store" });
      out.push({ path, status: r.status, who: (await r.json()) as Who });
    }
    setResults(out);
  };

  return (
    <Panel title="Browser fetch, same origin" tag="fetch('/hono/…'), fetch('/py/…')">
      <button className={btn} onClick={run}>Call both services</button>
      {origin && (
        <p className="mt-3 text-sm">
          Page origin <code>{origin}</code>. Requests use relative paths, so the browser treats them as the
          same site: no CORS. <code>sec-fetch-site</code> below is what the browser reported.
        </p>
      )}
      <div className="mt-2 space-y-2">
        {results.map((r) => (
          <pre key={r.path} className="overflow-auto rounded bg-zinc-50 p-2 text-xs dark:bg-zinc-900">
            {`${r.path} → ${r.status}\n${JSON.stringify(r.who, null, 2)}`}
          </pre>
        ))}
      </div>
    </Panel>
  );
}
