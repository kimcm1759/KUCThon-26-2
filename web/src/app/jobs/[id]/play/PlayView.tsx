"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { defaultAlignment } from "@/lib/alignment";
import { rememberTool } from "@/lib/client";
import { sound, SOUND_OBJECTS, soundObjectFor, type SoundObject } from "@/lib/sound/engine";
import { TOOLS, type ToolId } from "@/lib/tools";
import type { Job, StepStatus } from "@/lib/types";
import SoundSync, { useSoundSync } from "./SoundSync";

const Composite = dynamic(() => import("@/components/Composite"), { ssr: false });

/**
 * Full-screen smash view in the 빠각 style: dark frame, the photo fitted to
 * any phone shape, tools along the bottom like the tab bar. While the 3D
 * model is still being made it shows the steps instead.
 */
export default function PlayView({ id }: { id: string }) {
  const router = useRouter();
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
  // ?sync: sound timing panel for whoever is making the sound files.
  const sync = useSoundSync(params.has("sync"));

  // Load, and keep polling while the pipeline is still running.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let alive = true;
    const load = () =>
      fetch(`/api/jobs/${id}`, { cache: "no-store" })
        .then(async (r) => {
          if (!alive) return;
          if (!r.ok) return setError("물건을 찾을 수 없어요");
          const j: Job = await r.json();
          setJob(j);
          if (j.status === "running") timer = setTimeout(load, 2000);
        })
        .catch(() => alive && setError("불러오지 못했어요"));
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [id]);

  const back = () => (window.history.length > 1 ? router.back() : router.push("/collection"));

  if (error || !job) {
    return (
      <main className="fixed inset-0 flex items-center justify-center bg-bg text-[14px] text-subtle">
        {error ?? "불러오는 중…"}
      </main>
    );
  }

  const v = job.verify.result;
  const background = job.backgrounds.find((c) => c.id === job.selection.background && c.url);
  const model = job.models.find((c) => c.id === job.selection.model && c.url);
  if (!model?.url || !job.mask.bbox) return <Progress job={job} onBack={back} />;

  const alignment = job.alignment ?? defaultAlignment(job.photo.width, job.photo.height, v?.camera_elevation_deg);
  const soundObject = soundChoice === "auto" ? soundObjectFor(v) : soundChoice;

  const reset = () => {
    setBroken(false);
    setDurability(null);
    setResetSignal((n) => n + 1);
  };

  return (
    <main
      className="fixed inset-0 flex flex-col overflow-hidden bg-bg text-white select-none"
      style={{ overscrollBehavior: "none" }}
    >
      <header className="pad-top relative z-10 flex shrink-0 items-center gap-3 pr-[18px] pl-4">
        <BackButton onClick={back} />
        <h1 className="min-w-0 flex-1 truncate text-[24px] leading-9 font-semibold tracking-[1.2px]">
          {v?.label_ko ?? "물건"}
        </h1>
        <button
          onClick={() => {
            sound.unlock();
            sound.setMuted(!muted);
            setMuted(!muted);
          }}
          className="flex size-9 items-center justify-center rounded-full bg-surface text-[16px]"
          aria-label={muted ? "소리 켜기" : "소리 끄기"}
        >
          {muted ? "🔇" : "🔊"}
        </button>
        <Link
          href={`/jobs/${id}`}
          className="flex size-9 items-center justify-center rounded-full bg-surface"
          aria-label="위치 맞추기·설정"
        >
          <span
            className="icon-mask block size-6 text-white"
            style={{ "--icon": "url(/figma/tab-settings.svg)" } as React.CSSProperties}
          />
        </Link>
      </header>

      <div className="relative z-10 flex shrink-0 items-center justify-between gap-3 px-[25px] pt-3 pb-2">
        <Durability durability={durability} broken={broken} />
        <select
          value={soundChoice}
          onChange={(e) => setSoundChoice(e.target.value as SoundObject | "auto")}
          className="rounded-[10px] bg-surface px-2 py-1 text-[12px] text-subtle outline-none"
          aria-label="소리 세트"
        >
          <option value="auto">소리: 자동</option>
          {SOUND_OBJECTS.map((o) => (
            <option key={o.id} value={o.id}>
              소리: {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4" style={{ containerType: "size" }}>
        {params.has("sync") && <SoundSync log={sync.log} clear={sync.clear} object={soundObject} />}
        <Composite
          fit
          backgroundUrl={background?.url ?? job.photo.url}
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
            onBreak: () => {
              setBroken(true);
              rememberTool(id, tool);
            },
            onEvent: params.has("sync") ? sync.add : undefined,
            onHit: (remaining, total) => {
              setDurability({ remaining, total });
              rememberTool(id, tool);
            },
          }}
        />
      </div>

      <div className="relative z-10 flex shrink-0 items-center justify-between gap-3 px-[25px] pt-3">
        <p className="min-w-0 truncate text-[12px] tracking-[0.6px] text-muted">
          {TOOLS.find((t) => t.id === tool)?.hint}
        </p>
        <button
          onClick={reset}
          className={`h-9 shrink-0 rounded-[16px] px-4 text-[14px] font-medium ${
            broken ? "bg-primary text-white" : "bg-surface text-primary"
          }`}
        >
          {broken ? "다시 붙이기" : "원래대로"}
        </button>
      </div>

      {/* Tools, laid out like the tab bar. */}
      <nav className="pad-bottom relative z-10 shrink-0 pt-[10px]">
        <ul className="grid h-[57px] grid-cols-5 items-start px-2">
          {TOOLS.map((t) => {
            const active = t.id === tool;
            return (
              <li key={t.id}>
                <button
                  onClick={() => {
                    sound.unlock();
                    setTool(t.id);
                  }}
                  aria-pressed={active}
                  className={`flex w-full flex-col items-center gap-[7px] ${active ? "text-primary" : "text-white"}`}
                >
                  <span
                    className={`flex size-9 items-center justify-center rounded-full text-[22px] ${
                      active ? "bg-primary/20 ring-2 ring-primary" : ""
                    }`}
                  >
                    {t.icon}
                  </span>
                  <span className="text-[12px] tracking-[0.6px] whitespace-nowrap">{t.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </main>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label="뒤로" className="size-6 shrink-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/figma/back.svg" alt="" width={24} height={24} className="block" />
    </button>
  );
}

function Durability({
  durability,
  broken,
}: {
  durability: { remaining: number; total: number } | null;
  broken: boolean;
}) {
  if (broken) return <p className="text-[12px] font-bold tracking-[0.5px] text-lime">BROKEN!</p>;
  if (!durability) return <p className="text-[12px] tracking-[0.6px] text-muted">내구도</p>;
  return (
    <div className="flex items-center gap-1" aria-label={`내구도 ${durability.remaining}/${durability.total}`}>
      {Array.from({ length: durability.total }, (_, i) => (
        <span key={i} className={`h-2 w-5 rounded-full ${i < durability.remaining ? "bg-primary" : "bg-surface"}`} />
      ))}
    </div>
  );
}

function group(items: Job["models"]): StepStatus {
  if (items.length === 0) return "pending";
  if (items.some((c) => c.status === "done")) return "done";
  if (items.some((c) => c.status === "running" || c.status === "pending")) return "running";
  return "error";
}

const STEPS: [string, (j: Job) => StepStatus][] = [
  ["물건 확인", (j) => j.verify.status],
  ["물체 분리", (j) => j.mask.status],
  ["빈 배경 만들기", (j) => group(j.backgrounds)],
  ["3D 모델 만들기", (j) => group(j.models)],
];

const STEP_TEXT: Record<StepStatus, [string, string]> = {
  done: ["완료", "text-primary"],
  error: ["실패", "text-red-400"],
  running: ["진행 중", "animate-pulse text-subtle"],
  pending: ["대기", "text-muted"],
  skipped: ["건너뜀", "text-muted"],
};

/** While the pipeline runs (or after it failed): the photo and each step. */
function Progress({ job, onBack }: { job: Job; onBack: () => void }) {
  const failed = job.status === "error" || job.status === "rejected";
  const v = job.verify.result;
  return (
    <main className="fixed inset-0 flex flex-col bg-bg text-white">
      <header className="pad-top flex shrink-0 items-center gap-3 pr-[18px] pl-4">
        <BackButton onClick={onBack} />
        <h1 className="truncate text-[24px] leading-9 font-semibold tracking-[1.2px]">{v?.label_ko ?? "확인 중"}</h1>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-[25px] pt-[29px] pb-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={job.photo.url} alt="" className="max-h-[50dvh] w-full rounded-[24px] object-cover" />
        <ol className="flex flex-col gap-2">
          {STEPS.map(([label, status]) => {
            const [text, color] = STEP_TEXT[status(job)];
            return (
              <li key={label} className="flex h-14 items-center justify-between rounded-[16px] bg-surface px-6 text-[16px]">
                {label}
                <span className={`text-[12px] tracking-[0.6px] ${color}`}>{text}</span>
              </li>
            );
          })}
        </ol>
        {job.status === "rejected" && v && (
          <p className="text-[14px] leading-relaxed text-subtle">
            {v.reason} {v.retake_tip}
          </p>
        )}
        {failed ? (
          <Link
            href={`/jobs/${job.id}`}
            className="flex h-14 items-center justify-center rounded-[16px] bg-primary text-[18px] font-medium tracking-[0.9px]"
          >
            자세히 보기
          </Link>
        ) : (
          <p className="text-center text-[12px] tracking-[0.6px] text-muted">
            3D 모델은 2~3분쯤 걸려요. 다 되면 바로 부술 수 있어요.
          </p>
        )}
      </div>
    </main>
  );
}
