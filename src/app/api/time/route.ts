import { connection } from "next/server";

export async function GET(request: Request) {
  await connection();
  return Response.json({
    now: new Date().toISOString(),
    url: request.url,
    // Read at runtime: shows whether .env.production / real env vars apply.
    greeting: process.env.APP_GREETING ?? null,
    servedBy: request.headers.get("x-from-proxy") ? "proxy ran" : "no proxy",
  });
}
