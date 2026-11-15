"use client";

import { useEffect, useRef, useState } from "react";
import { Log, Panel, btn } from "./panel";
import { stamp } from "./lib";

/** Node SSE: an endless tick stream from /hono/sse. */
export function NodeSse() {
  const [lines, setLines] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const es = useRef<EventSource | null>(null);

  const start = () => {
    es.current?.close();
    const source = new EventSource("/hono/sse");
    source.onopen = () => setOpen(true);
    source.addEventListener("tick", (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      setLines((l) => [`${stamp()}  tick #${d.n} from api ${d.instance}`, ...l].slice(0, 50));
    });
    source.onerror = () => setLines((l) => [`${stamp()}  error / reconnecting…`, ...l]);
    es.current = source;
  };
  const stop = () => {
    es.current?.close();
    es.current = null;
    setOpen(false);
  };
  useEffect(() => () => es.current?.close(), []);

  return (
    <Panel title="Node · Server-Sent Events" tag="EventSource('/hono/sse')">
      <div className="flex gap-2">
        <button className={btn} onClick={start} disabled={open}>Start</button>
        <button className={btn} onClick={stop} disabled={!open}>Stop</button>
      </div>
      <Log lines={lines} />
    </Panel>
  );
}

/** Python SSE: a finite job with progress events, closed on "done". */
export function PySse() {
  const [pct, setPct] = useState(0);
  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const es = useRef<EventSource | null>(null);

  const run = () => {
    setPct(0);
    setLines([]);
    setRunning(true);
    const source = new EventSource("/py/sse/job?steps=10&delay=0.4");
    source.addEventListener("progress", (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      setPct(d.pct);
      setLines((l) => [`${stamp()}  step ${d.step}/${d.of}  largest prime so far: ${d.primes_so_far}`, ...l]);
    });
    source.addEventListener("done", (e) => {
      // A finished stream must be closed here, or EventSource reconnects and reruns the job.
      source.close();
      setRunning(false);
      setLines((l) => [`${stamp()}  done ${(e as MessageEvent).data}`, ...l]);
    });
    source.onerror = () => {
      source.close();
      setRunning(false);
      setLines((l) => [`${stamp()}  error`, ...l]);
    };
    es.current = source;
  };
  useEffect(() => () => es.current?.close(), []);

  return (
    <Panel title="Python · Server-Sent Events" tag="EventSource('/py/sse/job')">
      <div className="flex items-center gap-3">
        <button className={btn} onClick={run} disabled={running}>Run job</button>
        <div className="h-2 flex-1 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-800">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <span className="w-10 text-right text-sm tabular-nums">{pct}%</span>
      </div>
      <Log lines={lines} />
    </Panel>
  );
}
