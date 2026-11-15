// Probe the compose stack through one entry point.
//   node scripts/stack-test.mjs http://localhost:8080   (gateway)
//   node scripts/stack-test.mjs http://localhost:9081   (bare outer nginx)
//   node scripts/stack-test.mjs http://localhost:9082   (typical outer nginx)
// ORIGIN=... overrides the Origin sent with Server Actions (simulates the
// public origin a browser would send, e.g. https://app.example.com).
const base = process.argv[2] ?? "http://localhost:8080";
const origin = process.env.ORIGIN ?? new URL(base).origin;
const wsBase = base.replace(/^http/, "ws");
const rows = [];
const row = (name, ok, detail) => rows.push({ name, ok, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path, init) {
  const r = await fetch(base + path, init);
  return { status: r.status, headers: r.headers, text: await r.text() };
}

async function check(name, fn) {
  try {
    await fn();
  } catch (e) {
    row(name, false, `ERROR ${e.cause?.code ?? ""} ${e.message}`);
  }
}

// Read an SSE stream; returns [{event, data, t}] until `stop` says so.
async function readSse(path, stop, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = performance.now();
  const events = [];
  try {
    const r = await fetch(base + path, { signal: ctrl.signal, headers: { accept: "text/event-stream" } });
    if (!r.ok) throw new Error(`status ${r.status}`);
    const reader = r.body.getReader();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += new TextDecoder().decode(value);
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = { event: "message", data: "", t: Math.round(performance.now() - t0) };
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) ev.event = line.slice(6).trim();
          if (line.startsWith("data:")) ev.data += line.slice(5).trim();
        }
        events.push(ev);
        if (stop(events)) {
          ctrl.abort();
          return events;
        }
      }
    }
  } catch (e) {
    if (e.name !== "AbortError") throw e;
  } finally {
    clearTimeout(timer);
  }
  return events;
}

function openWs(path) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsBase + path);
    const inbox = [];
    ws.onmessage = (e) => inbox.push(JSON.parse(e.data));
    ws.onopen = () => resolve({ ws, inbox });
    ws.onerror = () => reject(new Error("connection failed"));
    setTimeout(() => reject(new Error("timeout")), 3000);
  });
}
async function waitFor(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await sleep(50);
  }
  return null;
}

// --- routing ------------------------------------------------------------------
for (const [path, expect, owner] of [
  ["/", 200, "next"],
  ["/playground", 200, "next"],
  ["/hono", 200, "api"],
  ["/hono/", 200, "api"],
  ["/honolulu", 404, "next"],
  ["/py/health", 200, "py"],
  ["/py/docs", 200, "py"],
  ["/hono/calls-py", 200, "api->py"],
]) {
  await check(`route ${path}`, async () => {
    const r = await get(path);
    const who = r.headers.get("x-powered-by") === "Next.js" ? "next" : r.text.slice(0, 50).replace(/\s+/g, " ");
    row(`route ${path}`, r.status === expect, `${r.status} (expected ${expect}, ${owner}) ${who}`);
  });
}

await check("static assets", async () => {
  const html = (await get("/playground")).text;
  const chunk = html.match(/\/_next\/static\/[^"'\s]+\.js/)?.[0];
  const a = await get(chunk);
  const b = await get("/test.png");
  row("static assets", a.status === 200 && b.status === 200, `${chunk} ${a.status}, /test.png ${b.status}`);
});

await check("next server -> api + py", async () => {
  const html = (await get("/playground")).text.replace(/<!-- -->/g, "");
  const block = html.match(/data-testid="server-side"[^>]*>([\s\S]*?)<\/pre>/)?.[1] ?? "";
  const ok = (block.match(/: 200 /g) ?? []).length === 3;
  row("next server -> api + py", ok, block.replace(/&quot;/g, '"').split("\n").map((l) => l.slice(0, 40)).join(" | "));
});

// --- SSE ------------------------------------------------------------------------
await check("SSE node /hono/sse", async () => {
  const ev = await readSse("/hono/sse", (e) => e.length >= 3);
  const ts = ev.map((e) => e.t);
  row("SSE node /hono/sse", ev.length === 3 && ts[0] < 500 && ts[2] - ts[0] > 1500, `3 ticks at ${ts.join("/")}ms`);
});
await check("SSE py /py/sse/job", async () => {
  const ev = await readSse("/py/sse/job?steps=5&delay=0.3", (e) => e.at(-1)?.event === "done");
  const prog = ev.filter((e) => e.event === "progress").map((e) => e.t);
  const done = ev.find((e) => e.event === "done");
  row("SSE py /py/sse/job", prog.length === 5 && prog[0] < 700 && !!done, `progress at ${prog.join("/")}ms, done@${done?.t}ms`);
});

// --- WebSocket --------------------------------------------------------------------
await check("WS chat across api replicas", async () => {
  // Keep opening B until it lands on a different replica than A.
  const welcome = async (c) => (await waitFor(() => c.inbox.find((m) => m.type === "welcome")))?.instance;
  const a = await openWs("/hono/ws");
  const ia = await welcome(a);
  let b, ib;
  for (let i = 0; i < 8; i++) {
    b = await openWs("/hono/ws");
    ib = await welcome(b);
    if (ib !== ia || i === 7) break; // single replica: keep the last socket open
    b.ws.close();
  }
  a.ws.send("hello from A");
  const got = await waitFor(() => b.inbox.find((m) => m.type === "chat" && m.text === "hello from A"));
  const presence = b.inbox.filter((m) => m.type === "presence").at(-1);
  a.ws.close();
  b.ws.close();
  const cross = ia !== ib;
  row("WS chat across api replicas", !!got && cross,
    `A on ${ia}, B on ${ib}${cross ? "" : " (same replica!)"}: ${got ? `B got "${got.text}" via ${got.via}` : "B got nothing"}; online=${presence?.online}`);
});
await check("WS py analyse", async () => {
  const p = await openWs("/py/ws");
  p.ws.send("hello python");
  const got = await waitFor(() => p.inbox.find((m) => m.type === "analysis"));
  p.ws.close();
  row("WS py analyse", got?.upper === "HELLO PYTHON", got ? `upper="${got.upper}" vowels=${got.vowels}` : "no reply");
});
// --- jobs: BullMQ -> Python worker, progress over SSE ----------------------------
await check("job via BullMQ + SSE", async () => {
  const job = JSON.parse((await get("/hono/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: '{"steps":5}' })).text);
  if (!job.id) throw new Error(JSON.stringify(job));
  const ev = await readSse(`/hono/jobs/${job.id}/events`, (e) => ["completed", "failed"].includes(e.at(-1)?.event), 15000);
  const prog = ev.filter((e) => e.event === "progress");
  const end = ev.at(-1);
  const result = end && JSON.parse(end.data);
  row("job via BullMQ + SSE", end?.event === "completed" && prog.length >= 4,
    `queued via ${job.queuedBy}, ${prog.length} progress events (${prog.map((e) => e.t).join("/")}ms), streamed by ${result?.streamedBy}, processed by ${result?.data?.processed_by}`);
  // A client that connects after the job finished still gets the result.
  const late = await readSse(`/hono/jobs/${job.id}/events`, (e) => ["completed", "failed"].includes(e.at(-1)?.event), 5000);
  row("job: late client gets result", late.at(-1)?.event === "completed", late.map((e) => e.event).join(" -> "));
});

// --- replicas ---------------------------------------------------------------------
await check("load balanced replicas", async () => {
  const seen = {};
  for (const [svc, path] of [["web", "/api/instance"], ["api", "/hono/whoami"], ["py", "/py/whoami"]]) {
    const ids = new Set();
    for (let i = 0; i < 12; i++) ids.add(JSON.parse((await get(path)).text).instance);
    seen[svc] = ids.size;
  }
  row("load balanced replicas", null, `distinct replicas answering: web=${seen.web} api=${seen.api} py=${seen.py}`);
});
await check("shared state across web replicas", async () => {
  const counts = new Set();
  const instances = new Set();
  for (let i = 0; i < 8; i++) {
    const t = (await get("/actions")).text.replace(/<!-- -->/g, "");
    counts.add(t.match(/data-testid="count">([^<]+)/)?.[1]);
    instances.add(t.match(/rendered by web ([0-9a-f]+)/)?.[1]);
  }
  row("shared state across web replicas", counts.size === 1 && instances.size > 1, `count ${[...counts].join(",")} on ${instances.size} replicas`);
});
await check("action: form from one replica, POST to another", async () => {
  const results = [];
  for (let i = 0; i < 4; i++) {
    const page = (await get("/actions")).text.replace(/<!-- -->/g, "");
    const from = page.match(/rendered by web ([0-9a-f]+)/)?.[1];
    const id = page.match(/name="(\$ACTION_ID_[^"]+)"/)?.[1];
    const fd = new FormData();
    fd.set(id, "");
    fd.set("by", "1");
    const r = await fetch(base + "/actions", { method: "POST", body: fd, headers: { origin } });
    const to = (await r.text()).replace(/<!-- -->/g, "").match(/rendered by web ([0-9a-f]+)/)?.[1];
    results.push({ status: r.status, from, to });
  }
  const cross = results.filter((r) => r.from && r.to && r.from !== r.to);
  row("action: form from one replica, POST to another", cross.length > 0 && results.every((r) => r.status === 200),
    `${cross.length}/4 crossed replicas, statuses ${results.map((r) => r.status).join(",")}`);
});

await check("connections cleaned up", async () => {
  await sleep(1500);
  const byInstance = {};
  for (let i = 0; i < 12; i++) {
    const n = JSON.parse((await get("/hono/stats")).text);
    const p = JSON.parse((await get("/py/stats")).text);
    byInstance[n.instance] = n.sseClients + n.wsClients;
    byInstance[p.instance] = p.sse_clients + p.ws_clients;
  }
  const open = Object.values(byInstance).reduce((a, b) => a + b, 0);
  row("connections cleaned up", open === 0, `${open} open across ${Object.keys(byInstance).length} replicas`);
});

// --- server actions (CSRF origin check) ---------------------------------------
async function serverAction(originHeader) {
  const page = await get("/actions");
  const id = page.text.match(/name="(\$ACTION_ID_[^"]+)"/)?.[1];
  const before = Number(page.text.match(/data-testid="count">(\d+)/)?.[1]);
  const fd = new FormData();
  fd.set(id, "");
  fd.set("by", "1");
  const r = await fetch(base + "/actions", { method: "POST", body: fd, headers: { origin: originHeader }, redirect: "manual" });
  await r.text();
  const after = Number((await get("/actions")).text.match(/data-testid="count">(\d+)/)?.[1]);
  return { status: r.status, before, after };
}
await check("action, matching Origin", async () => {
  const r = await serverAction(origin);
  row("action, matching Origin", r.after === r.before + 1, `${r.status} count ${r.before}->${r.after}`);
});
await check("action, foreign Origin (must fail)", async () => {
  const r = await serverAction("https://evil.example");
  row("action, foreign Origin (must fail)", r.after === r.before, `${r.status} count ${r.before}->${r.after}`);
});

// --- URLs and forwarded headers ---------------------------------------------------
await check("redirect Location", async () => {
  const r = await fetch(base + "/proxy-redirect", { redirect: "manual" });
  const loc = r.headers.get("location");
  row("redirect Location", loc?.startsWith("/") || loc?.startsWith(base), `${r.status} ${loc}`);
});
for (const svc of ["hono", "py"]) {
  await check(`${svc} whoami`, async () => {
    const j = JSON.parse((await get(`/${svc}/whoami`)).text);
    row(`${svc} whoami`, null, `url=${j.url} host=${j.host} xfh=${j["x-forwarded-host"]} xfp=${j["x-forwarded-proto"]}`);
  });
}

// --- uploads + slow request ----------------------------------------------------------
const big = new Uint8Array(5 * 1024 * 1024);
for (const svc of ["hono", "py"]) {
  await check(`upload 5MB /${svc}`, async () => {
    const r = await fetch(`${base}/${svc}/upload`, { method: "POST", body: big });
    const t = await r.text();
    row(`upload 5MB /${svc}`, r.status === 200 && t.includes(String(big.length)), `${r.status} ${t.slice(0, 50).replace(/\s+/g, " ")}`);
  });
}
await check("slow /py/slow?s=2", async () => {
  const r = await get("/py/slow?s=2");
  row("slow /py/slow?s=2", r.status === 200, `${r.status} ${r.text}`);
});

// --- report -----------------------------------------------------------------------
console.log(`\n${base}`);
for (const r of rows) {
  const mark = r.ok === null ? "info" : r.ok ? "ok  " : "FAIL";
  console.log(`  ${mark}  ${r.name.padEnd(34)} ${r.detail}`);
}
process.exitCode = rows.some((r) => r.ok === false) ? 1 : 0;
