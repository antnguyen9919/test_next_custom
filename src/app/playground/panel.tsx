import type { ReactNode } from "react";

export function Panel({ title, tag, children }: { title: string; tag: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-900">{tag}</code>
      </div>
      {children}
    </section>
  );
}

export function Log({ lines }: { lines: string[] }) {
  return (
    <pre className="mt-3 h-40 overflow-auto rounded bg-zinc-50 p-2 text-xs leading-5 dark:bg-zinc-900">
      {lines.length ? lines.join("\n") : "…"}
    </pre>
  );
}

export const btn =
  "rounded bg-black px-3 py-1 text-sm text-white disabled:opacity-40 dark:bg-white dark:text-black";
