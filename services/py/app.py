"""Python service (FastAPI). Owns the /py/* namespace behind the gateway.

  GET  /py/health        liveness
  GET  /py/whoami        what this service sees (forwarded headers, Sec-Fetch-Site)
  GET  /py/compute       some actual Python work
  GET  /py/sse/job       Server-Sent Events: progress of a fake job, then "done"
  WS   /py/ws            WebSocket: analyses each message you send
  GET  /py/stats         open SSE/WS connections (to check cleanup)
  POST /py/upload        counts the streamed request body
  GET  /py/slow          sleeps ?s= seconds
"""
import asyncio
import json
import socket
import sys

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse

app = FastAPI(title="py", docs_url="/py/docs", openapi_url="/py/openapi.json")
stats = {"sse_clients": 0, "ws_clients": 0}
INSTANCE = socket.gethostname()  # container hostname: which replica answered


def primes(n: int) -> list[int]:
    found: list[int] = []
    x = 2
    while len(found) < n:
        if all(x % p for p in found if p * p <= x):
            found.append(x)
        x += 1
    return found


@app.get("/py/health")
def health():
    return {"ok": True, "service": "py", "instance": INSTANCE, "python": sys.version.split()[0]}


@app.get("/py/stats")
def get_stats():
    return {"instance": INSTANCE, **stats}


@app.get("/py/compute")
def compute(n: int = 20):
    return {"n": n, "primes": primes(min(n, 5000))}


@app.get("/py/whoami")
def whoami(request: Request):
    h = request.headers
    return {
        "service": "py",
        "instance": INSTANCE,
        "url": str(request.url),
        "host": h.get("host"),
        "origin": h.get("origin"),
        "sec-fetch-site": h.get("sec-fetch-site"),
        "x-forwarded-host": h.get("x-forwarded-host"),
        "x-forwarded-proto": h.get("x-forwarded-proto"),
        "x-forwarded-for": h.get("x-forwarded-for"),
    }


@app.post("/py/upload")
async def upload(request: Request):
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
    return {"bytes": size}


@app.get("/py/slow")
async def slow(s: float = 1.0):
    await asyncio.sleep(s)
    return {"slept": s}


@app.get("/py/sse/job")
async def sse_job(request: Request, steps: int = 10, delay: float = 0.4):
    """A finite stream: progress events, then a "done" event. The client must
    close its EventSource on "done", or the browser reconnects and reruns it."""
    steps = max(1, min(steps, 100))

    async def events():
        stats["sse_clients"] += 1
        try:
            for i in range(1, steps + 1):
                if await request.is_disconnected():
                    return
                await asyncio.sleep(delay)
                payload = {"step": i, "of": steps, "pct": round(100 * i / steps), "primes_so_far": primes(i * 50)[-1]}
                yield f"event: progress\nid: {i}\ndata: {json.dumps(payload)}\n\n"
            yield f"event: done\ndata: {json.dumps({'ok': True, 'python': sys.version.split()[0]})}\n\n"
        finally:
            stats["sse_clients"] -= 1

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@app.websocket("/py/ws")
async def ws(websocket: WebSocket):
    await websocket.accept()
    stats["ws_clients"] += 1
    try:
        await websocket.send_json({"type": "welcome", "python": sys.version.split()[0]})
        while True:
            text = await websocket.receive_text()
            await websocket.send_json({
                "type": "analysis",
                "text": text,
                "upper": text.upper(),
                "reversed": text[::-1],
                "words": len(text.split()),
                "vowels": sum(ch in "aeiouAEIOU" for ch in text),
            })
    except WebSocketDisconnect:
        pass
    finally:
        stats["ws_clients"] -= 1
