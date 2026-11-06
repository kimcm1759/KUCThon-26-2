"use client";

import { useEffect, useState } from "react";
import { sound, type SoundObject } from "@/lib/sound/engine";
import type { SmashEvent } from "@/lib/tools";

/** A pause this long starts a new take, so times restart from +0.000. */
const TAKE_GAP_MS = 2500;

export interface SyncEntry extends SmashEvent {
  /** performance.now() when it fired. */
  at: number;
  take: number;
}

/** Collects sound events while ?sync is on. */
export function useSoundSync(on: boolean) {
  const [log, setLog] = useState<SyncEntry[]>([]);

  useEffect(() => {
    sound.placeholder = on;
    return () => {
      sound.placeholder = false;
    };
  }, [on]);

  const add = (e: SmashEvent) => {
    const at = performance.now();
    setLog((prev) => {
      const last = prev[prev.length - 1];
      const take = !last ? 1 : at - last.at > TAKE_GAP_MS ? last.take + 1 : last.take;
      return [...prev, { ...e, at, take }].slice(-200);
    });
  };
  return { log, add, clear: () => setLog([]) };
}

/**
 * Sound sync panel (/jobs/<id>/play?sync): every sound moment with its time
 * from the start of the take and the file it plays. Missing files beep, each
 * event at its own pitch, so the timing can be heard before any file exists.
 */
export default function SoundSync({
  log,
  clear,
  object,
  children,
}: {
  log: SyncEntry[];
  clear: () => void;
  object?: SoundObject;
  /** Extra controls in the panel's top row (the sound set picker). */
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const [beep, setBeep] = useState(true);
  const take = log[log.length - 1]?.take;
  const rows = log.filter((e) => e.take === take);
  const start = rows[0]?.at ?? 0;

  const text = () =>
    rows
      .map((e, i) => {
        const dt = i ? `(+${Math.round(e.at - rows[i - 1].at)}ms)` : "";
        return `${((e.at - start) / 1000).toFixed(3)}s\t${e.tool}/${e.event}${loopMark(e)}\t${fileFor(e, object)}\t${dt}`;
      })
      .join("\n");

  return (
    <div className="pointer-events-auto absolute inset-x-2 top-2 z-20 rounded-[12px] bg-black/75 text-[11px] text-white backdrop-blur-sm">
      <div className="flex items-center gap-2 px-3 py-2">
        <button onClick={() => setOpen(!open)} className="font-semibold">
          🎚 소리 맞추기 {take ? `· 테이크 ${take}` : ""} {open ? "▾" : "▸"}
        </button>
        <span className="flex-1" />
        {children}
        <label className="flex items-center gap-1 text-subtle">
          <input
            type="checkbox"
            checked={beep}
            onChange={(e) => {
              setBeep(e.target.checked);
              sound.placeholder = e.target.checked;
            }}
          />
          없는 소리 삐
        </label>
        <button onClick={() => void navigator.clipboard?.writeText(text())} className="rounded bg-surface px-2 py-0.5">
          복사
        </button>
        <button onClick={clear} className="rounded bg-surface px-2 py-0.5">
          비우기
        </button>
      </div>
      {open && (
        <ol className="max-h-[22dvh] overflow-y-auto px-3 pb-2 font-mono leading-[18px]">
          {rows.length === 0 && <li className="text-subtle">물체를 때려 보세요. 소리가 날 때마다 여기에 찍혀요.</li>}
          {rows.map((e, i) => {
            const file = fileFor(e, object);
            return (
              <li key={`${e.at}-${i}`} className="flex gap-2">
                <span className="w-[52px] shrink-0 text-right text-zoom">{((e.at - start) / 1000).toFixed(3)}s</span>
                <span className="shrink-0 whitespace-nowrap">
                  {e.tool}/{e.event}
                  {loopMark(e)}
                </span>
                <span className={`min-w-0 break-all ${file.startsWith("없음") ? "text-red-400" : "text-lime"}`}>{file}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function loopMark(e: SmashEvent) {
  return e.loop === "start" ? " 🔁시작" : e.loop === "stop" ? " 🔁끝" : "";
}

/** The file that plays, or where to put one. */
function fileFor(e: SmashEvent, object?: SoundObject) {
  if (e.loop === "stop") return "";
  const files = sound.files(e.event, { object, tool: e.tool });
  if (files.length) return files.length > 1 ? `${files[0]} 외 ${files.length - 1}개` : files[0];
  return `없음 → ${object ? `${object} 또는 ` : ""}_common/${e.tool}/${e.event}.mp3`;
}
