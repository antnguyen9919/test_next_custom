import { Redis, type RedisOptions } from "ioredis";

export const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

/**
 * For request-path commands: fail fast instead of queueing while Redis is down,
 * so a Redis outage degrades features instead of hanging requests.
 */
export const fastOpts: RedisOptions = {
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  commandTimeout: 500,
  connectTimeout: 2000,
  retryStrategy: (n) => Math.min(n * 200, 2000),
};

/** BullMQ's blocking connections (QueueEvents/Worker) require this. */
export const blockingOpts: RedisOptions = { maxRetriesPerRequest: null };

export function client(opts: RedisOptions, name: string) {
  const r = new Redis(REDIS_URL, { ...opts, connectionName: name });
  r.on("error", (e) => console.warn(`[redis:${name}] ${e.message}`));
  return r;
}
