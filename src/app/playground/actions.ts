"use server";

// Runs on the Next server. It reaches Python over the internal compose network
// (PY_URL=http://py:8000), never through a public host.
export async function askPython(_prev: string, formData: FormData) {
  const n = Number(formData.get("n") ?? 10);
  const base = process.env.PY_URL;
  if (!base) return "PY_URL is not set (run through docker compose).";
  try {
    const r = await fetch(`${base}/py/compute?n=${n}`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    const d = await r.json();
    return `Python returned the first ${d.n} primes: ${d.primes.slice(-5).join(", ")} … (last 5)`;
  } catch (e) {
    return `Python unreachable: ${(e as Error).message}`;
  }
}

// Next server -> Node service (internal network) -> BullMQ -> Python worker.
export async function startJob(steps: number): Promise<{ id?: string; queuedBy?: string; error?: string }> {
  const base = process.env.API_URL;
  if (!base) return { error: "API_URL is not set (run through docker compose)." };
  try {
    const r = await fetch(`${base}/hono/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ steps }),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    return await r.json();
  } catch (e) {
    return { error: `api unreachable: ${(e as Error).message}` };
  }
}
