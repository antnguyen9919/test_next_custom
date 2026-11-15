import { headers } from "next/headers";
import { Suspense } from "react";

async function RequestInfo() {
  const h = await headers();
  await new Promise((r) => setTimeout(r, 1500));
  return (
    <ul data-testid="streamed">
      <li>user-agent: {h.get("user-agent")}</li>
      <li>x-from-proxy: {h.get("x-from-proxy") ?? "(not set)"}</li>
      <li>rendered at: {new Date().toISOString()}</li>
    </ul>
  );
}

export default function DynamicPage() {
  return (
    <main className="p-8 font-sans">
      <h1 className="text-xl font-semibold">Dynamic + streaming</h1>
      <p>The shell arrives immediately; the list below streams in ~1.5s later.</p>
      <Suspense fallback={<p>Loading request info…</p>}>
        <RequestInfo />
      </Suspense>
    </main>
  );
}
