import "server-only";
import { Redis } from "ioredis";

// One lazy client per Next server process. Nothing connects during `next build`,
// and request-path commands fail fast (no offline queue) if Redis is down.
let client: Redis | undefined;
let everConnected = false;

export async function redis(): Promise<Redis> {
  client ??= new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    commandTimeout: 500,
    connectTimeout: 2000,
    connectionName: "web",
  })
    .on("error", (e) => console.warn(`[redis] ${e.message}`))
    .on("ready", () => (everConnected = true));

  // Only the very first connect is waited for. After that, if Redis is down,
  // commands fail immediately instead of adding latency to every request.
  if (client.status !== "ready" && !everConnected) {
    if (client.status === "wait") client.connect().catch(() => {});
    // Wait briefly for the connection; if Redis is down the command fails fast.
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 1000);
      client!.once("ready", () => {
        clearTimeout(t);
        resolve();
      });
    });
  }
  return client;
}
