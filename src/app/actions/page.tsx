import { hostname } from "node:os";
import { connection } from "next/server";
import { Suspense } from "react";
import { getCount, increment } from "./counter";

async function Count() {
  await connection(); // read per request, not at build time
  const count = await getCount();
  return (
    <>
      <strong data-testid="count">{count ?? "unavailable (Redis down)"}</strong>{" "}
      <small data-testid="instance">(rendered by web {hostname()})</small>
    </>
  );
}

export default function ActionsPage() {
  return (
    <main className="p-8 font-sans">
      <h1 className="text-xl font-semibold">Server Action</h1>
      <p>
        Shared count (Redis):{" "}
        <Suspense fallback="…">
          <Count />
        </Suspense>
      </p>
      <form action={increment} className="mt-4">
        <input type="hidden" name="by" value="1" />
        <button className="rounded bg-black px-3 py-1 text-white dark:bg-white dark:text-black">
          +1
        </button>
      </form>
    </main>
  );
}
