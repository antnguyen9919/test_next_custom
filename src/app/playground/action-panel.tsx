"use client";

import { useActionState } from "react";
import { askPython } from "./actions";
import { Panel, btn } from "./panel";

export function ServerActionPanel() {
  const [result, action, pending] = useActionState(askPython, "");
  return (
    <Panel title="Server Action → Python" tag="Next server → http://py:8000">
      <form action={action} className="flex items-center gap-2">
        <input
          name="n"
          type="number"
          defaultValue={100}
          min={1}
          max={5000}
          className="w-24 rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
        <button className={btn} disabled={pending}>{pending ? "Asking…" : "Ask Python for primes"}</button>
      </form>
      {result && <p className="mt-3 text-sm">{result}</p>}
    </Panel>
  );
}
