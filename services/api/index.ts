/**
 * Node service (Hono). Owns the /hono/* namespace behind the gateway.
 * The prefix lives here, so the gateway never rewrites paths.
 *
 * Runs as N replicas. Anything that must be seen by every replica goes through
 * Redis: chat messages (pub/sub), the online count, and jobs (BullMQ).
 *
 *   GET  /hono/health             liveness
 *   GET  /hono/whoami             what this service sees (forwarded headers, Sec-Fetch-Site)
 *   GET  /hono/calls-py           node -> python over the internal network
 *   GET  /hono/sse                Server-Sent Events: a tick every second
 *   GET  /hono/ws                 WebSocket chat room, shared by all replicas via Redis
 *   POST /hono/jobs               enqueue a job for the Python worker (BullMQ)
 *   GET  /hono/jobs/:id/events    SSE: that job's progress, from whichever replica you hit
 *   GET  /hono/stats              open SSE/WS connections on this replica
 *   POST /hono/upload             counts the streamed request body
 */
import { hostname } from "node:os";
import { serve, upgradeWebSocket } from "@hono/node-server";
import { Job, Queue, QueueEvents } from "bullmq";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { WSContext } from "hono/ws";
import { WebSocketServer } from "ws";
import { blockingOpts, client, fastOpts } from "./redis";

const port = Number(process.env.PORT ?? 4000);
const PY_URL = process.env.PY_URL ?? "http://localhost:8000";
// Container hostname: shows which replica handled a request/connection.
const instance = hostname();

let shuttingDown = false;
let sseClients = 0;
const wsClients = new Map<WSContext, string>();

// --- Redis ------------------------------------------------------------------------
const pub = client(fastOpts, "pub");
const sub = client({ retryStrategy: (n) => Math.min(n * 200, 2000) }, "sub");
const CHAT = "chat";

// Every replica subscribes; a message published by any replica reaches the
// sockets connected to all of them.
sub.subscribe(CHAT).catch((e) => console.warn(`[redis] subscribe failed: ${e.message}`));
sub.on("message", (channel, raw) => {
  if (channel === CHAT) sendLocal(raw);
});

function sendLocal(raw: string) {
  for (const ws of wsClients.keys()) ws.send(raw);
}

async function broadcast(msg: object) {
  const raw = JSON.stringify(msg);
  try {
    await pub.publish(CHAT, raw);
  } catch {
    sendLocal(raw); // Redis down: degrade to this replica only.
  }
}

// Online count across replicas: each replica writes its own count with a TTL,
// so a crashed replica's sockets drop out of the total within 30s.
async function publishPresence() {
  try {
    await pub.set(`presence:${instance}`, wsClients.size, "EX", 30);
  } catch {}
}
async function onlineEverywhere(): Promise<number> {
  try {
    let total = 0;
    let cursor = "0";
    do {
      const [next, keys] = await pub.scan(cursor, "MATCH", "presence:*", "COUNT", 100);
      cursor = next;
      if (keys.length) for (const v of await pub.mget(...keys)) total += Number(v ?? 0);
    } while (cursor !== "0");
    return total;
  } catch {
    return wsClients.size;
  }
}

// --- Jobs (BullMQ) --------------------------------------------------------------------
// Producer + ONE QueueEvents listener per process. Job SSE streams subscribe to
// it in memory, so connection count doesn't multiply Redis connections.
const JOBS = "jobs";
// The producer fails fast (no offline queue) so POST /jobs returns 503 instead
// of hanging while Redis is down. Only QueueEvents/Worker need blocking options.
const queue = new Queue(JOBS, { connection: client(fastOpts, "queue") });
const queueEvents = new QueueEvents(JOBS, { connection: client(blockingOpts, "queue-events") });
type JobEvent = { event: string; data: unknown };
const jobListeners = new Map<string, Set<(e: JobEvent) => void>>();
function emitJob(jobId: string, e: JobEvent) {
  for (const fn of jobListeners.get(jobId) ?? []) fn(e);
}
queueEvents.on("progress", ({ jobId, data }) => emitJob(jobId, { event: "progress", data }));
queueEvents.on("completed", ({ jobId, returnvalue }) => emitJob(jobId, { event: "completed", data: returnvalue }));
queueEvents.on("failed", ({ jobId, failedReason }) => emitJob(jobId, { event: "failed", data: failedReason }));
queueEvents.on("error", (e) => console.warn(`[queue-events] ${e.message}`));

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms}ms`)), ms))]);
}

// --- App ----------------------------------------------------------------------------
// strict: false -> /hono and /hono/ both match.
const app = new Hono({ strict: false }).basePath("/hono");

app.get("/", (c) =>
  c.json({ service: "api", routes: ["health", "whoami", "calls-py", "sse", "ws", "jobs", "stats", "upload"] }),
);
app.get("/health", (c) => c.json({ ok: true, service: "api", instance }));
app.get("/stats", (c) => c.json({ instance, sseClients, wsClients: wsClients.size }));

app.get("/whoami", (c) =>
  c.json({
    service: "api",
    instance,
    url: c.req.url,
    host: c.req.header("host"),
    origin: c.req.header("origin") ?? null,
    "sec-fetch-site": c.req.header("sec-fetch-site") ?? null,
    "x-forwarded-host": c.req.header("x-forwarded-host") ?? null,
    "x-forwarded-proto": c.req.header("x-forwarded-proto") ?? null,
    "x-forwarded-for": c.req.header("x-forwarded-for") ?? null,
  }),
);

app.get("/calls-py", async (c) => {
  try {
    const r = await fetch(`${PY_URL}/py/compute?n=10`, { signal: AbortSignal.timeout(5000) });
    return c.json({ from: "api", instance, py: await r.json() });
  } catch (e) {
    return c.json({ from: "api", error: `python service unreachable: ${(e as Error).message}` }, 502);
  }
});

app.post("/upload", async (c) => {
  let bytes = 0;
  const reader = c.req.raw.body?.getReader();
  for (;;) {
    const { done, value } = (await reader?.read()) ?? { done: true, value: undefined };
    if (done) break;
    bytes += value.byteLength;
  }
  return c.json({ bytes });
});

// SSE: one event per second. The tick doubles as a heartbeat, so proxies'
// idle timeouts never fire.
app.get("/sse", (c) =>
  streamSSE(c, async (stream) => {
    sseClients++;
    let open = true;
    stream.onAbort(() => {
      open = false;
    });
    try {
      for (let n = 1; open && !shuttingDown; n++) {
        await stream.writeSSE({
          event: "tick",
          id: String(n),
          data: JSON.stringify({ n, time: new Date().toISOString(), instance, sseClients, wsClients: wsClients.size }),
        });
        await stream.sleep(1000);
      }
    } finally {
      sseClients--;
    }
  }),
);

// Jobs: enqueue for the Python worker.
app.post("/jobs", async (c) => {
  const { steps = 10 } = await c.req.json<{ steps?: number }>().catch(() => ({ steps: 10 }));
  try {
    const job = await withTimeout(
      queue.add("primes", { steps: Math.max(1, Math.min(Number(steps), 50)), requestedVia: instance }, {
        removeOnComplete: { age: 3600 },
        removeOnFail: { age: 3600 },
      }),
      2000,
    );
    return c.json({ id: job.id, queuedBy: instance });
  } catch (e) {
    return c.json({ error: `queue unavailable: ${(e as Error).message}` }, 503);
  }
});

// Job progress over SSE. Snapshot first (a late or reconnecting client still
// sees the current state or the result), then live events until it finishes.
app.get("/jobs/:id/events", (c) =>
  streamSSE(c, async (stream) => {
    const id = c.req.param("id");
    sseClients++;
    let finished = false;
    let wake = () => {};
    const send = async (e: JobEvent) => {
      await stream.writeSSE({ event: e.event, data: JSON.stringify({ data: e.data, streamedBy: instance }) });
      if (e.event === "completed" || e.event === "failed") finished = true;
      wake();
    };
    const listener = (e: JobEvent) => void send(e);
    if (!jobListeners.has(id)) jobListeners.set(id, new Set());
    jobListeners.get(id)!.add(listener);
    stream.onAbort(() => {
      finished = true;
      wake();
    });
    try {
      const job = await withTimeout(Job.fromId(queue, id), 2000).catch(() => undefined);
      if (!job) await send({ event: "failed", data: "unknown job" });
      else {
        const state = await job.getState();
        await stream.writeSSE({ event: "state", data: JSON.stringify({ data: { state, progress: job.progress }, streamedBy: instance }) });
        if (state === "completed") await send({ event: "completed", data: job.returnvalue });
        if (state === "failed") await send({ event: "failed", data: job.failedReason });
      }
      // Wait for completion; a comment every 15s keeps proxies from timing out.
      while (!finished && !shuttingDown) {
        await new Promise<void>((r) => {
          wake = r;
          setTimeout(r, 15_000);
        });
        if (!finished) await stream.write(": keepalive\n\n");
      }
    } finally {
      jobListeners.get(id)?.delete(listener);
      if (!jobListeners.get(id)?.size) jobListeners.delete(id);
      sseClients--;
    }
  }),
);

// WebSocket chat, shared across replicas.
app.get(
  "/ws",
  upgradeWebSocket(() => ({
    async onOpen(_evt, ws) {
      const name = `user-${Math.random().toString(36).slice(2, 6)}`;
      wsClients.set(ws, name);
      await publishPresence();
      ws.send(JSON.stringify({ type: "welcome", you: name, instance }));
      void broadcast({ type: "presence", online: await onlineEverywhere(), event: `${name} joined via ${instance}` });
    },
    onMessage(evt, ws) {
      void broadcast({ type: "chat", from: wsClients.get(ws), text: String(evt.data), at: new Date().toISOString(), via: instance });
    },
    async onClose(_evt, ws) {
      const name = wsClients.get(ws);
      wsClients.delete(ws);
      await publishPresence();
      void broadcast({ type: "presence", online: await onlineEverywhere(), event: `${name} left` });
    },
  })),
);

// Heartbeat for idle sockets (keeps proxies from timing them out) + presence refresh.
setInterval(async () => {
  await publishPresence();
  sendLocal(JSON.stringify({ type: "heartbeat", online: await onlineEverywhere(), instance }));
}, 20_000).unref();

// --- Server ---------------------------------------------------------------------------
const wss = new WebSocketServer({ noServer: true });
const server = serve({ fetch: app.fetch, port, hostname: "0.0.0.0", websocket: { server: wss } }, (info) =>
  console.log(`api ${instance} listening on :${info.port}`),
);

// Graceful stop: end SSE loops, close websockets, then the HTTP server.
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, () => {
    console.log(`${sig}: closing ${sseClients} SSE + ${wsClients.size} WS connections`);
    shuttingDown = true;
    for (const client of wss.clients) client.close(1001, "server shutting down");
    void pub.del(`presence:${instance}`).catch(() => {});
    server.close(() => process.exit(0));
    setTimeout(() => {
      if ("closeAllConnections" in server) server.closeAllConnections();
      process.exit(0);
    }, 1500).unref();
  });
}
