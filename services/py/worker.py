"""BullMQ worker: processes "jobs" queued by the Node service.

Runs as its own compose service (N replicas). Each job reports progress, which
reaches the browser via BullMQ events -> Node SSE, whichever replica it's on.
"""
import asyncio
import os
import signal
import socket
import time

from bullmq import Worker

from app import primes

INSTANCE = socket.gethostname()
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")


async def process(job, token):
    steps = int(job.data.get("steps", 10))
    started = time.time()
    largest = 0
    for i in range(1, steps + 1):
        largest = primes(i * 200)[-1]  # some real CPU work per step
        await asyncio.sleep(0.25)       # and pretend the rest is slow I/O
        await job.updateProgress({"step": i, "of": steps, "pct": round(100 * i / steps), "largest_prime": largest})
    return {
        "largest_prime": largest,
        "steps": steps,
        "seconds": round(time.time() - started, 2),
        "processed_by": INSTANCE,
        "queued_via": job.data.get("requestedVia"),
    }


async def main():
    worker = Worker("jobs", process, {"connection": REDIS_URL, "concurrency": 4})
    print(f"worker {INSTANCE} consuming 'jobs' from {REDIS_URL}", flush=True)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)
    await stop.wait()
    print("shutting down: finishing in-flight jobs", flush=True)
    await worker.close()


if __name__ == "__main__":
    asyncio.run(main())
