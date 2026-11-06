"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { defaultAlignment } from "@/lib/alignment";
import { sound, SOUND_OBJECTS, soundObjectFor, type SoundObject } from "@/lib/sound/engine";
import { TOOLS, type ToolId } from "@/lib/tools";
import type { Job } from "@/lib/types";

const Composite = dynamic(() => import("@/components/Composite"), { ssr: false });

/**
 * Full-screen smash view for demos: the photo fitted to any phone shape
 * (tall Android, iPhone with notch), tools along the bottom, nothing else.
 */
export default function PlayView({ id }: { id: string }) {
  const params = useSearchParams();
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<ToolId>("hammer");
  const [broken, setBroken] = useState(false);
  const [durability, setDurability] = useState<{ remaining: number; total: number } | null>(null);
  const [resetSignal, setResetSignal] = useState(0);
  const [muted, setMuted] = useState(false);
  // ?sound=can forces a sound set; otherwise it follows what Claude saw.
  const [soundChoice, setSoundChoice] = useState<SoundObject | "auto">(
    (params.get("sound") as SoundObject | null) ?? "auto",
  );

  useEffect(() => {
    fetch(`/api/jobs/${id}`, { cache: "no-store" })
      .then(async (r) => (r.ok ? setJob(await r.json()) : setError("작업을 찾을 수 없어요")))
      .catch(() => setError("불러오지 못했어요"));
  }, [id]);

  if (error || !job) {
    return (
      <main className="fixed inset-0 flex items-center justify-center bg-black text-sm text-neutral-400">
        {error ?? "불러오는 중…"}
      </main>
    );
  }

  const v = job.verify.result;
  const background = job.backgrounds.find((c) => c.id === job.selection.background && c.url);
  const model = job.models.find((c) => c.id === job.selection.model && c.url);
  if (!model || !job.mask.bbox) {
    return (
      <main className="fixed inset-0 flex flex-col items-center justify-center gap-3 bg-black text-sm text-neutral-400">
        아직 3D 모델이 준비되지 않았어요.
        <Link href={`/jobs/${id}`} className="text-orange-400">
          작업 화면으로
        </Link>
      </main>
    );
  }
  const alignment =
    job.alignment ?? defaultAlignment(job.photo.width, job.photo.height, v?.camera_elevation_deg);
  const soundObject = soundChoice === "auto" ? soundObjectFor(v) : soundChoice;
  const bgUrl = background?.url ?? job.photo.url;

  const reset = () => {
    setBroken(false);
    setDurability(null);
    setResetSignal((n) => n + 1);
  };

  return (
    <main
      className="fixed inset-0 flex select-none flex-col overflow-hidden bg-black text-white"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
        overscrollBehavior: "none",
      }}
    >
      {/* Blurred copy of the photo fills the bars around it on tall screens. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={bgUrl} alt="" className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-35 blur-2xl" />

      <header className="relative z-10 flex items-center gap-2 px-3 py-2 text-sm">
        <Link href="/" className="rounded-lg px-2 py-1 text-neutral-300" aria-label="수집 일기로">
          ←
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{v?.label_ko ?? "물건"}</p>
          {durability && !broken && (
            <p className="text-[11px] tracking-widest text-orange-400">
              {"●".repeat(durability.remaining)}
              <span className="text-neutral-600">{"●".repeat(durability.total - durability.remaining)}</span>
            </p>
          )}
        </div>
        <select
          value={soundChoice}
          onChange={(e) => setSoundChoice(e.target.value as SoundObject | "auto")}
          className="rounded-lg bg-white/10 px-2 py-1 text-xs"
          aria-label="소리 세트"
        >
          <option value="auto">소리: 자동</option>
          {SOUND_OBJECTS.map((o) => (
            <option key={o.id} value={o.id}>
              소리: {o.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            sound.unlock();
            sound.setMuted(!muted);
            setMuted(!muted);
          }}
          className="rounded-lg bg-white/10 px-2 py-1"
          aria-label={muted ? "소리 켜기" : "소리 끄기"}
        >
          {muted ? "🔇" : "🔊"}
        </button>
        <Link href={`/jobs/${id}`} className="rounded-lg bg-white/10 px-2 py-1" aria-label="위치 맞추기·설정">
          ⚙
        </Link>
      </header>

      <div className="relative z-10 flex min-h-0 flex-1 items-center justify-center px-2" style={{ containerType: "size" }}>
        <Composite
          fit
          backgroundUrl={bgUrl}
          photoUrl={job.photo.url}
          modelUrl={model.url}
          width={job.photo.width}
          height={job.photo.height}
          bbox={job.mask.bbox}
          alignment={alignment}
          overlay={0}
          stats={params.has("fps")}
          smash={{
            material: v?.material,
            fragility: v?.fragility,
            realHeightCm: v?.est_size_cm.h,
            resetSignal,
            tool,
            soundObject,
            onBreak: () => setBroken(true),
            onHit: (remaining, total) => setDurability({ remaining, total }),
          }}
        />
      </div>

      <nav className="relative z-10 flex flex-col gap-2 px-2 pt-2 pb-3">
        <div className="flex items-center justify-between gap-2 px-1">
          <p className="truncate text-[11px] text-neutral-400">{TOOLS.find((t) => t.id === tool)?.hint}</p>
          <button
            onClick={reset}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-xs ${
              broken ? "bg-orange-500 font-semibold text-black" : "bg-white/10 text-neutral-200"
            }`}
          >
            {broken ? "다시 붙이기" : "원래대로"}
          </button>
        </div>
        <div className="grid grid-cols-5 gap-1.5">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                sound.unlock();
                setTool(t.id);
              }}
              className={`flex flex-col items-center rounded-2xl py-2 text-[11px] leading-tight ${
                t.id === tool ? "bg-orange-500 text-black" : "bg-white/10 text-neutral-200"
              }`}
            >
              <span className="text-2xl">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
      </nav>
    </main>
  );
}
