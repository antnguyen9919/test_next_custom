import { hostname } from "node:os";
import { connection } from "next/server";

// Which replica answered (container hostname). Handy behind a load balancer.
export async function GET() {
  await connection();
  return Response.json({ service: "web", instance: hostname() });
}
