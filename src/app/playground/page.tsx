import { hostname } from "node:os";
import { connection } from "next/server";
import { Suspense } from "react";
import { ServerActionPanel } from "./action-panel";
import { SameOriginFetch } from "./fetch-panel";
import { JobPanel } from "./job-panel";
import { Panel } from "./panel";
import { NodeSse, PySse } from "./sse-panels";
import { NodeWs, PyWs } from "./ws-panels";

// Server-side: Next calls the services over the internal network. The URLs come
// from runtime env (API_URL / PY_URL), set in docker-compose.yml.
async function probe(label: string, url: string | undefined) {
  if (!url) return `${label}: env not set`;
  try {
    const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(3000) });
    return `${label}: ${r.status} ${(await r.text()).slice(0, 120)}`;
  } catch (e) {
    return `${label}: unreachable (${(e as Error).message})`;
  }
}

async function ServerSide() {
  await connection();
  const lines = await Promise.all([
    probe("api /hono/health", process.env.API_URL && `${process.env.API_URL}/hono/health`),
    probe("py  /py/health", process.env.PY_URL && `${process.env.PY_URL}/py/health`),
    probe("api /hono/calls-py (node → python)", process.env.API_URL && `${process.env.API_URL}/hono/calls-py`),
  ]);
  lines.unshift(`rendered by web ${hostname()}`);
  return (
    <pre data-testid="server-side" className="overflow-auto rounded bg-zinc-50 p-2 text-xs leading-5 dark:bg-zinc-900">
      {lines.join("\n")}
    </pre>
  );
}

export default function Playground() {
  return (
    <main className="mx-auto w-full max-w-5xl p-6 font-sans">
      <h1 className="text-2xl font-semibold">Next ↔ Node ↔ Python playground</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        The browser only talks to this origin. The gateway sends <code>/hono/*</code> to the Node service,{" "}
        <code>/py/*</code> to the Python service, and everything else to Next. Each runs as several replicas;
        names like <code>web 1a2b3c</code> show which one answered. Shared state lives in Redis.
      </p>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <JobPanel />
        </div>
        <NodeSse />
        <PySse />
        <NodeWs />
        <PyWs />
        <SameOriginFetch />
        <div className="space-y-4">
          <Panel title="Rendered on the Next server" tag="RSC → http://api:4000, http://py:8000">
            <Suspense fallback={<p className="text-sm">Calling services…</p>}>
              <ServerSide />
            </Suspense>
          </Panel>
          <ServerActionPanel />
        </div>
      </div>
    </main>
  );
}
