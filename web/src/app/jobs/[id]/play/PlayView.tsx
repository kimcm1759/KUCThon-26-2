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

/** Figma 부수기 무기 icons. */
const TOOL_ICON: Record<ToolId, string> = {
  hammer: "/figma/tool-hammer.svg",
  bat: "/figma/tool-bat.svg",
  press: "/figma/tool-press.svg",
  laser: "/figma/tool-laser.svg",
  bomb: "/figma/tool-bomb.svg",
};

/**
 * Smash view (Figma 부수기): the photo in a rounded frame, 내 무기 tiles
 * below, 되돌리기 (and 저장 for a fresh camera shot) at the top. While the
 * 3D model is still being made it shows the steps instead.
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

  const save = <SaveButton job={job} onSaved={setJob} />;
  const v = job.verify.result;
  const background = job.backgrounds.find((c) => c.id === job.selection.background && c.url);
  const model = job.models.find((c) => c.id === job.selection.model && c.url);
  if (!model?.url || !job.mask.bbox) return <Progress job={job} onBack={back} save={save} />;

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
      <Header title={v?.label_ko ?? "물건"} onBack={back}>
        <button
          onClick={() => {
            sound.unlock();
            sound.setMuted(!muted);
            setMuted(!muted);
          }}
          className="glass relative flex size-[39px] shrink-0 items-center justify-center rounded-[16px] bg-primary/20 text-[16px] transition-colors duration-300 hover:bg-primary"
          aria-label={muted ? "소리 켜기" : "소리 끄기"}
        >
          {muted ? "🔇" : "🔊"}
        </button>
        {save}
        <FigmaButton onClick={reset}>되돌리기</FigmaButton>
      </Header>

      <div
        className="relative mt-4 flex min-h-0 flex-1 items-center justify-center px-4"
        style={{ containerType: "size" }}
      >
        {params.has("sync") && (
          <SoundSync log={sync.log} clear={sync.clear} object={soundObject}>
            <select
              value={soundChoice}
              onChange={(e) => setSoundChoice(e.target.value as SoundObject | "auto")}
              className="rounded bg-surface px-1 py-0.5 text-[11px] text-subtle outline-none"
              aria-label="소리 세트"
            >
              <option value="auto">자동</option>
              {SOUND_OBJECTS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </SoundSync>
        )}
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

      {/* 내 무기: 80px tiles, scrolls sideways when they don't all fit. */}
      <section className="pad-bottom relative z-10 shrink-0 pt-[22px]">
        <div className="flex items-center justify-between gap-3 px-6">
          <h2 className="shrink-0 text-[16px] font-semibold tracking-[0.8px]">내 무기</h2>
          <Status durability={durability} broken={broken} hint={TOOLS.find((t) => t.id === tool)?.hint} />
        </div>
        <ul className="mt-[18px] flex gap-[11px] overflow-x-auto px-6 [scrollbar-width:none]">
          {TOOLS.map((t) => {
            const active = t.id === tool;
            return (
              <li key={t.id} className="shrink-0">
                <button
                  onClick={() => {
                    sound.unlock();
                    setTool(t.id);
                  }}
                  aria-pressed={active}
                  className="flex w-20 flex-col items-center"
                >
                  <span
                    className={`glass relative flex size-20 items-center justify-center rounded-[16px] border-2 bg-gradient-to-b from-[rgba(24,23,28,0.2)] to-[rgba(80,76,95,0.2)] ${
                      active ? "border-primary" : "border-transparent"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={TOOL_ICON[t.id]} alt="" width={36} height={36} className="block size-9" />
                  </span>
                  <span
                    className={`mt-[15px] text-[12px] tracking-[0.6px] whitespace-nowrap ${active ? "text-primary" : "text-white"}`}
                  >
                    {t.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}

function Header({ title, onBack, children }: { title: string; onBack: () => void; children?: React.ReactNode }) {
  return (
    <header className="pad-top relative z-10 flex shrink-0 items-center gap-[10px] pr-[19px] pl-[25px]">
      <BackButton onClick={onBack} />
      <h1 className="min-w-0 flex-1 truncate text-[24px] leading-9 font-semibold tracking-[1.2px]">{title}</h1>
      {children}
    </header>
  );
}

/**
 * Figma 저장 button (Frame 33): glass over 20% blue; on mouse enter it turns
 * solid blue without the glass (Variant2), fading back on leave.
 */
function FigmaButton({ className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`glass relative flex h-[39px] shrink-0 items-center justify-center rounded-[16px] bg-primary/20 p-[10px] text-[16px] font-medium tracking-[0.8px] whitespace-nowrap text-white transition-colors duration-300 hover:bg-primary hover:[backdrop-filter:none] hover:after:opacity-0 disabled:opacity-60 ${className}`}
    />
  );
}

/** Keeps a fresh camera shot in 내 모음; only shown for drafts. */
function SaveButton({ job, onSaved }: { job: Job; onSaved: (j: Job) => void }) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  if (!job.draft && state !== "saved") return null;
  const save = async () => {
    setState("saving");
    try {
      const r = await fetch(`/api/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft: false }),
      });
      if (!r.ok) throw new Error();
      onSaved(await r.json());
      setState("saved");
    } catch {
      setState("error");
    }
  };
  return (
    <FigmaButton onClick={save} disabled={state === "saving" || state === "saved"}>
      {state === "saved" ? "저장됨" : state === "error" ? "다시 저장" : "저장"}
    </FigmaButton>
  );
}

/** Right of 내 무기: durability once it's being hit, the tool's hint before that. */
function Status({
  durability,
  broken,
  hint,
}: {
  durability: { remaining: number; total: number } | null;
  broken: boolean;
  hint?: string;
}) {
  if (broken) return <p className="text-[12px] font-bold tracking-[0.5px] text-lime">BROKEN!</p>;
  if (!durability) return <p className="min-w-0 truncate text-[12px] tracking-[0.6px] text-muted">{hint}</p>;
  return (
    <div className="flex items-center gap-1" aria-label={`내구도 ${durability.remaining}/${durability.total}`}>
      {Array.from({ length: durability.total }, (_, i) => (
        <span key={i} className={`h-2 w-5 rounded-full ${i < durability.remaining ? "bg-primary" : "bg-surface"}`} />
      ))}
    </div>
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
function Progress({ job, onBack, save }: { job: Job; onBack: () => void; save: React.ReactNode }) {
  const failed = job.status === "error" || job.status === "rejected";
  const v = job.verify.result;
  return (
    <main className="fixed inset-0 flex flex-col bg-bg text-white">
      <Header title={v?.label_ko ?? "확인 중"} onBack={onBack}>
        {!failed && save}
      </Header>
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
