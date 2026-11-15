"use server";

import { refresh } from "next/cache";
import { redis } from "@/lib/redis";

// Shared by every Next replica. (An in-memory `let count` would differ per replica.)
const KEY = "demo:counter";

export async function getCount(): Promise<number | null> {
  try {
    return Number((await (await redis()).get(KEY)) ?? 0);
  } catch {
    return null; // Redis down: render "unavailable" instead of failing the page
  }
}

export async function increment(formData: FormData) {
  await (await redis()).incrby(KEY, Number(formData.get("by") ?? 1));
  refresh();
}
