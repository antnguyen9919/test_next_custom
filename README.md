# Next.js + Node + Python behind one gateway (multi-replica)

A plain Next.js 16 app (`output: "standalone"`, no custom server) shipped next to a Node service (Hono) and a Python service (FastAPI). Redis and BullMQ hold everything that has to be shared between replicas. A docker compose stack runs it, and the only published port is an internal nginx gateway. The devops nginx proxies to that one port per environment.

```
          devops nginx (TLS, domains)
                 │  one port per environment
                 ▼
        ┌──── gateway (nginx) ─────┐   /hono/*  → api   (Node/Hono, N replicas)
        │  round-robin, re-resolves │   /py/*    → py    (FastAPI,   N replicas)
        └───────────────────────────┘   /*       → web   (Next.js,   N replicas)
                                         worker  (Python BullMQ consumer, N replicas)
                                         redis   (pub/sub, shared state, job queue)
```

## Run it

```sh
# one compose project per environment (own network, Redis volume, port)
docker compose -p next-prod --env-file deploy/prod.env up -d --build --wait   # :8080
docker compose -p next-dev  --env-file deploy/dev.env  up -d --build --wait   # :8081

open http://localhost:8080/playground

node scripts/stack-test.mjs http://localhost:8080   # end-to-end checks (exit 1 on failure)
```

`--env-file` (and `-p`) are needed on every compose command for that environment, including `down`. Replica counts and the port come from `deploy/*.env`: `WEB_REPLICAS`, `API_REPLICAS`, `PY_REPLICAS`, `WORKER_REPLICAS`, `GATEWAY_PORT`, `GATEWAY_BIND`. `GATEWAY_BIND` defaults to `127.0.0.1`. Use `0.0.0.0` only if the devops nginx runs on another host or can't reach the host's loopback.

**Local development**: same topology, with `next dev` on the host:

```sh
pnpm dev          # Next on :3000 (reads .env.development)
pnpm dev:stack    # gateway(:8090) + api + py + worker + redis in Docker, rebuilt on change (compose --watch)
open http://localhost:8090/playground   # HMR goes through the gateway too
```

`next dev` alone (port 3000) works for pages, but `/hono` and `/py` exist only behind the gateway.

## The playground (`/playground`)

| Panel | Path the browser uses | What it shows |
| --- | --- | --- |
| Background job | Server Action → `http://api:4000/hono/jobs` → BullMQ → Python worker; browser follows `EventSource('/hono/jobs/:id/events')` | queue → progress → result; which api replica queued and streamed it, which worker ran it |
| Node SSE | `EventSource('/hono/sse')` | tick per second, which api replica |
| Python SSE | `EventSource('/py/sse/job')` | finite progress stream (client closes on `done`) |
| Node WebSocket chat | `new WebSocket(ws(s)://<same host>/hono/ws)` | broadcast across api replicas via Redis pub/sub; open two tabs |
| Python WebSocket | `new WebSocket(.../py/ws)` | FastAPI processes each message |
| Browser fetch | `fetch('/hono/whoami')`, `fetch('/py/whoami')` | relative URLs, same origin, what each service sees |
| Rendered on the server | RSC → `http://api:4000`, `http://py:8000` | Next server calling services over the internal network |
| Server Action → Python | Next server → `http://py:8000` | server-to-server |

**"Not external hosts."** The browser only ever uses relative paths on its own origin, so there's no CORS and no service URLs in client code. A grep of the shipped client chunks found only `/hono/*` and `/py/*` paths, plus one display label. Server-side code reaches the services by compose DNS (`API_URL`, `PY_URL`, `REDIS_URL`, set at runtime). That is the internal Docker network, never a public host.

## Multi-replica: what breaks and what fixes it

Measured with 3 `web`, 2 `api`, 2 `py`, 2 `worker`, and **no Redis** first (the control):

| Problem with plain replicas | Fix here |
| --- | --- |
| WebSocket chat reached only sockets on the same api replica (failed 2 of 3 runs) | Redis pub/sub. Every replica subscribes, and the online count is per-replica keys with a 30 s TTL |
| In-memory state differs per replica (counter showed 0, 1 and 2 across loads) | State lives in Redis (`src/lib/redis.ts`) |
| Background work tied to one process | BullMQ queue in Redis. Python workers consume it, and progress reaches the browser through whichever api replica it's connected to (one `QueueEvents` listener per process) |
| Server Actions across replicas | Already worked: same image, so same action IDs/keys. Verified with the form taken from one replica and POSTed to another |
| Load balancing | nginx resolves the service name through Docker DNS (re-resolved every 5 s) and round-robins across all replicas. No `depends_on`, so a missing service is a 502 on its prefix only |

Not needed for this app (dynamic dashboard): a shared Next cache. If you ever use ISR, `revalidateTag` or `'use cache'` across replicas, you'll need a shared cache handler. `@fortedigital/nextjs-cache-handler` covers the classic cache on Next 16, but not `cacheComponents`/`'use cache'`.

### Measured results

- **Full suite (25 pass/fail checks, 3 informational):** passes through the gateway and through a "typical" outer nginx.
- **Scale 3→2→3 (web) and 2→1→2 (api) under load:** 0 failed requests over ~8,000 GET requests in two rounds.
  - Before tuning, one request per service timed out. I then changed three settings at once (`proxy_connect_timeout 1s`, `proxy_next_upstream`, DNS cache 10 s → 5 s), so which one fixed it isn't isolated.
  - Only GETs were hammered. A POST in flight on a removed replica can still fail, and nginx doesn't retry POSTs.
  - SSE/WebSocket clients on a removed replica get disconnected. The playground's WebSocket panels don't auto-reconnect; the SSE panels do (EventSource).
- **Redis down:**
  - Pages, health checks, SSE and the Python service keep working.
  - The counter shows "unavailable".
  - Chat falls back to the local replica.
  - `POST /hono/jobs` returns 503 in ~16 ms.
  - Requests stay fast (20–140 ms) once a replica has connected at least once.
  - Everything recovers when Redis returns.
- **Python service down:** Next and api keep serving, `/py/*` returns 502, and the playground's server-side panel shows "unreachable".
- **Two environments side by side** (`next-prod` :8080, `next-dev` :8081): separate networks and Redis volumes. Chat in dev never reached prod, and the counters differ.
- **Shutdown:**
  - Next's `server.js` finishes in-flight requests on SIGTERM. Exit code 143 is normal for SIGTERM.
  - api closes WebSocket/SSE with code 1001 in ~1 s.
  - py closes in ~4 s (`--timeout-graceful-shutdown 3`).
  - The worker finishes its in-flight job before exiting (`stop_grace_period: 30s`), so the job completes in one attempt.
- **Dev mode:** `pnpm dev` + `pnpm dev:stack` work as documented. HMR goes through the gateway, and editing `services/api` triggers a rebuild that shows up through the gateway.
- **Real browser (headless Chrome via DevTools):** every playground panel worked with no console errors.
  - The page only talked to its own origin, over `http://` and `ws://`.
  - `fetch('/hono/…')` and `fetch('/py/…')` reported `sec-fetch-site: same-origin`.

## What the devops nginx needs

Tested with two stand-ins (`docker-compose.outer-test.yml`, `test/outer-nginx/*.conf`):

| Feature | Bare `proxy_pass` only | Typical config |
| --- | --- | --- |
| Pages, static chunks, public files, SSE (Node + Python), jobs, Python slow call (2 s) | ✅ | ✅ |
| WebSocket (Node + Python) | ❌ needs `Upgrade`/`Connection` headers + `proxy_http_version 1.1` | ✅ |
| Server Actions | ❌ needs `proxy_set_header Host $host` (Next compares `Origin` to the host) | ✅ |
| Uploads > 1 MB | ❌ needs `client_max_body_size` | ✅ |
| Real scheme (`https`) seen by services | ❌ | ✅ via `X-Forwarded-Proto` |

Notes:
- If the public URL has a non-standard port, forward `Host $http_host` (`$host` drops the port).
- nginx's default `proxy_read_timeout` of 60 s should be enough, though I didn't test connections idle for more than 60 s. The services send something at least every 20 s: SSE ticks every 1 s, job-stream keepalives every 15 s, WebSocket heartbeats every 20 s. Raise the timeout only for HTTP requests that stay silent longer than 60 s.
- SSE streamed even through the bare config. The gateway also sends `X-Accel-Buffering: no` as insurance.

## Security note

`/hono/*` and `/py/*` never pass through Next, so `src/proxy.ts` and any Next auth don't run for them. Each service must check the session itself (for example, the same session cookie validated against Redis or a JWT). In this demo, `/py/docs`, `/hono/stats`, the upload routes and the job endpoints are open.

## Files

```
Dockerfile                    Next.js standalone image (standard pattern)
docker-compose.yml            the stack; deploy/*.env per environment
docker-compose.dev.yml        dev override: gateway → next dev on the host
docker-compose.outer-test.yml test-only stand-ins for the devops nginx
gateway/                      nginx.conf + templates/gateway.conf.template (upstreams from env)
services/api/                 Hono: SSE, WebSocket chat (Redis), BullMQ producer + job SSE
services/py/                  FastAPI (app.py) + BullMQ worker (worker.py), one image
src/app/playground/           the demo page
src/lib/redis.ts              Next's Redis client (lazy, fail-fast)
scripts/stack-test.mjs        end-to-end checks against any entry point
```

## Not tested

- **Real TLS / real domains:** the stand-in fakes `X-Forwarded-Proto: https`.
- **Rolling deploys with two different builds live at once.** All replicas here run the same image. From memory, not verified here:
  - **Server actions:** pin `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` so they stay valid across builds.
  - **Mixed versions:** look at Next's `deploymentId` setting for skew between versions.
- **Replicas on several VMs:** everything here runs on one Docker host. If an environment's replicas span several VMs, every stack must use ONE shared Redis. Set `REDIS_URL` in `deploy/*.env`; otherwise chat, state and jobs split per VM.
- **Kubernetes/Swarm:** compose DNS round-robin and `deploy.replicas` are compose-specific. The app-level pieces (Redis, BullMQ, relative URLs) carry over.
- **Linux dev hosts:** `host.docker.internal` in `docker-compose.dev.yml` comes from `extra_hosts` (`/etc/hosts`). nginx's runtime resolver may not read that file, so the dev gateway may not reach `next dev` on Linux.

Leftovers from earlier experiments: `/static`, `/cached`, `/image`, `/api/revalidate` and `cacheComponents: true` in `next.config.ts` are cache probes and aren't needed for a dynamic dashboard.

## History of this repo

1. **Custom Hono server wrapping Next:** behaved the same as `next start`.
2. **Custom server with `output: "standalone"`:** made to work with a private env var (`__NEXT_PRIVATE_STANDALONE_CONFIG`).
3. **Both replaced** by this setup, which needs neither: plain Next standalone, with the extra services behind a gateway.
