"use client";

import { useEffect, useRef, useState } from "react";
import { startJob } from "./actions";
import { Log, Panel, btn } from "./panel";
import { stamp } from "./lib";

/**
 * Server Action enqueues (Next -> api -> BullMQ), a Python worker replica runs
 * the job, and progress streams back over SSE from whichever api replica the
 * browser happens to hit.
 */
export function JobPanel() {
  const [pct, setPct] = useState(0);
  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const es = useRef<EventSource | null>(null);
  const log = (s: string) => setLines((l) => [`${stamp()}  ${s}`, ...l].slice(0, 60));

  const run = async () => {
    es.current?.close();
    setPct(0);
    setLines([]);
    setRunning(true);
    const job = await startJob(12);
    if (!job.id) {
      log(`could not start: ${job.error}`);
      setRunning(false);
      return;
    }
    log(`job ${job.id} queued via api ${job.queuedBy}`);
    const source = new EventSource(`/hono/jobs/${job.id}/events`);
    const parse = (e: Event) => JSON.parse((e as MessageEvent).data) as { data: Record<string, unknown>; streamedBy: string };
    source.addEventListener("state", (e) => {
      const d = parse(e);
      log(`state ${d.data.state} (stream from api ${d.streamedBy})`);
    });
    source.addEventListener("progress", (e) => {
      const { data } = parse(e);
      setPct(Number(data.pct));
      log(`step ${data.step}/${data.of}  largest prime ${data.largest_prime}`);
    });
    const finish = (e: Event, label: string) => {
      source.close(); // finished: stop EventSource from reconnecting
      setRunning(false);
      const d = parse(e);
      log(`${label}: ${JSON.stringify(d.data)}`);
    };
    source.addEventListener("completed", (e) => finish(e, "completed"));
    source.addEventListener("failed", (e) => finish(e, "failed"));
    source.onerror = () => log("stream error / reconnecting…");
    es.current = source;
  };
  useEffect(() => () => es.current?.close(), []);

  return (
    <Panel title="Background job: Next → BullMQ → Python worker" tag="EventSource('/hono/jobs/:id/events')">
      <div className="flex items-center gap-3">
        <button className={btn} onClick={run} disabled={running}>Start job</button>
        <div className="h-2 flex-1 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-800">
          <div className="h-full bg-sky-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <span className="w-10 text-right text-sm tabular-nums">{pct}%</span>
      </div>
      <Log lines={lines} />
    </Panel>
  );
}
