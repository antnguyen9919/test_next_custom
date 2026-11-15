"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Log, Panel, btn } from "./panel";
import { stamp, wsUrl } from "./lib";

function useSocket(path: string, format: (msg: Record<string, unknown>) => string) {
  const [lines, setLines] = useState<string[]>([]);
  const [state, setState] = useState<"closed" | "connecting" | "open">("closed");
  const sock = useRef<WebSocket | null>(null);

  const connect = () => {
    sock.current?.close();
    setState("connecting");
    const ws = new WebSocket(wsUrl(path));
    ws.onopen = () => setState("open");
    ws.onclose = (e) => {
      setState("closed");
      setLines((l) => [`${stamp()}  closed (${e.code}${e.reason ? ` ${e.reason}` : ""})`, ...l]);
    };
    ws.onmessage = (e) => setLines((l) => [`${stamp()}  ${format(JSON.parse(e.data))}`, ...l].slice(0, 50));
    sock.current = ws;
  };
  const disconnect = () => sock.current?.close();
  const send = (text: string) => sock.current?.send(text);
  useEffect(() => () => sock.current?.close(), []);

  return { lines, state, connect, disconnect, send };
}

function SocketPanel(props: {
  title: string;
  path: string;
  placeholder: string;
  hint: string;
  format: (msg: Record<string, unknown>) => string;
}) {
  const { lines, state, connect, disconnect, send } = useSocket(props.path, props.format);
  const [text, setText] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim()) send(text);
    setText("");
  };
  return (
    <Panel title={props.title} tag={`new WebSocket('${props.path}')`}>
      <div className="flex items-center gap-2">
        <button className={btn} onClick={connect} disabled={state !== "closed"}>Connect</button>
        <button className={btn} onClick={disconnect} disabled={state !== "open"}>Disconnect</button>
        <span className="text-sm text-zinc-500">{state}</span>
      </div>
      <form onSubmit={submit} className="mt-2 flex gap-2">
        <input
          className="flex-1 rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={props.placeholder}
          disabled={state !== "open"}
        />
        <button className={btn} disabled={state !== "open"}>Send</button>
      </form>
      <p className="mt-1 text-xs text-zinc-500">{props.hint}</p>
      <Log lines={lines} />
    </Panel>
  );
}

export function NodeWs() {
  return (
    <SocketPanel
      title="Node · WebSocket chat"
      path="/hono/ws"
      placeholder="Say something to everyone"
      hint="Open a second tab: it may land on another api replica, and messages still reach both (Redis pub/sub)."
      format={(m) =>
        m.type === "chat" ? `${m.from}: ${m.text}   (sent via api ${m.via})` :
        m.type === "welcome" ? `you are ${m.you}, connected to api ${m.instance}` :
        m.type === "presence" ? `${m.event} (${m.online} online)` :
        `heartbeat (${m.online} online)`
      }
    />
  );
}

export function PyWs() {
  return (
    <SocketPanel
      title="Python · WebSocket"
      path="/py/ws"
      placeholder="Text for Python to analyse"
      hint="Each message is processed by FastAPI and the result is sent back."
      format={(m) =>
        m.type === "welcome" ? `connected to Python ${m.python}` :
        `"${m.text}" → upper="${m.upper}" reversed="${m.reversed}" words=${m.words} vowels=${m.vowels}`
      }
    />
  );
}
