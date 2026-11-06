"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { defaultAlignment } from "@/lib/alignment";
import { soundObjectFor } from "@/lib/sound/engine";
import { TOOLS, type ToolId } from "@/lib/tools";
import type { Alignment, Candidate, Job, StepStatus } from "@/lib/types";

const Composite = dynamic(() => import("@/components/Composite"), {
  ssr: false,
  loading: () => <div className="aspect-[3/4] w-full animate-pulse rounded-xl bg-neutral-900" />,
});

const MATERIAL_KO: Record<string, string> = {
  glass: "유리",
  ceramic: "도자기",
  metal: "금속",
  wood: "나무",
  plastic: "플라스틱",
  fabric: "천",
  paper: "종이",
  rubber: "고무",
  stone: "돌",
  electronics: "전자기기",
  food: "음식",
  other: "기타",
};

const FRAGILITY_KO: Record<string, string> = {
  shatters: "산산조각",
  cracks: "금이 감",
  dents: "찌그러짐",
  bends: "휘어짐",
  tears: "찢어짐",
  squishes: "짓눌림",
};

export default function JobView({ id }: { id: string }) {
  const [job, setJob] = useState<Job | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [edited, setAlignment] = useState<Alignment | null>(null);
  const [overlay, setOverlay] = useState(0);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const [broken, setBroken] = useState(false);
  const [durability, setDurability] = useState<{ remaining: number; total: number } | null>(null);
  const [resetSignal, setResetSignal] = useState(0);
  const [tool, setTool] = useState<ToolId>("hammer");
  // ?fps shows a frame-rate meter on the 3D view.
  const showStats = useSearchParams().has("fps");

  // Poll while the pipeline runs; a reloadKey bump restarts polling after a re-run.
  const running = !job || job.status === "running";
  useEffect(() => {
    let cancelled = false;
    const tick = () =>
      fetch(`/api/jobs/${id}`, { cache: "no-store" })
        .then(async (res) => {
          if (cancelled) return;
          if (res.status === 404) setNotFound(true);
          else if (res.ok) setJob(await res.json());
        })
        .catch(() => {});
    tick();
    const timer = running ? setInterval(tick, 2000) : undefined;
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [id, running, reloadKey]);

  const alignment =
    edited ??
    job?.alignment ??
    (job?.verify.result
      ? defaultAlignment(job.photo.width, job.photo.height, job.verify.result.camera_elevation_deg)
      : null);

  function editAlignment(a: Alignment) {
    setAlignment(a);
    setSaved("idle");
  }

  async function patch(body: Partial<Pick<Job, "selection" | "alignment" | "note">>) {
    const res = await fetch(`/api/jobs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) setJob(await res.json());
  }

  async function rerun(force: boolean) {
    await fetch(`/api/jobs/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force }),
    });
    setJob((j) => (j ? { ...j, status: "running" } : j));
    setReloadKey((k) => k + 1);
  }

  if (notFound) return <p className="p-6 text-neutral-400">작업을 찾을 수 없어요.</p>;
  if (!job) return <p className="p-6 text-neutral-400">불러오는 중…</p>;

  const v = job.verify.result;
  const background = job.backgrounds.find((c) => c.id === job.selection.background && c.url);
  const model = job.models.find((c) => c.id === job.selection.model && c.url);

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-6">
      <header className="flex items-center justify-between">
        <Link href="/" className="text-sm text-neutral-400">
          ← 수집 일기
        </Link>
        <span className="text-xs text-neutral-500">{job.id}</span>
      </header>

      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">{v?.label_ko ?? "분석 중…"}</h1>
        {model && (
          <Link href={`/jobs/${id}/play`} className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-semibold text-black">
            ▶ 부수기 화면
          </Link>
        )}
      </div>

      <Steps job={job} />

      {job.status === "error" && (
        <div className="rounded-xl border border-red-900 bg-red-950/40 p-4 text-sm">
          <p className="text-red-300">오류: {job.error}</p>
          <button onClick={() => rerun(false)} className="mt-3 rounded-lg bg-red-500 px-3 py-1.5 text-black">
            다시 시도
          </button>
        </div>
      )}

      {job.status === "rejected" && v && (
        <div className="rounded-xl border border-amber-900 bg-amber-950/30 p-4 text-sm">
          <p className="font-semibold text-amber-300">검증 탈락</p>
          <p className="mt-1 text-neutral-300">{v.reason}</p>
          {v.retake_tip && <p className="mt-1 text-neutral-400">재촬영 팁: {v.retake_tip}</p>}
          <div className="mt-3 flex gap-2">
            <Link href="/" className="rounded-lg bg-orange-500 px-3 py-1.5 text-black">
              다시 찍기
            </Link>
            <button onClick={() => rerun(true)} className="rounded-lg border border-neutral-600 px-3 py-1.5">
              그래도 진행
            </button>
          </div>
        </div>
      )}

      {/* Composite: the thing we are judging */}
      {job.mask.bbox && alignment && (
        <section className="flex flex-col gap-3">
          <Composite
            backgroundUrl={background?.url ?? job.photo.url}
            photoUrl={job.photo.url}
            modelUrl={model?.url}
            width={job.photo.width}
            height={job.photo.height}
            bbox={job.mask.bbox}
            alignment={alignment}
            overlay={overlay}
            stats={showStats}
            smash={{
              material: v?.material,
              fragility: v?.fragility,
              realHeightCm: v?.est_size_cm.h,
              resetSignal,
              tool,
              soundObject: soundObjectFor(v),
              onBreak: () => setBroken(true),
              onHit: (remaining, total) => setDurability({ remaining, total }),
              // Sound hooks go here (type: hit / break / explode / cut / crush).
              onEvent: (e) => console.debug("[smash]", e),
            }}
          />
          {model && (
            <>
              <div className="grid grid-cols-5 gap-1.5">
                {TOOLS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTool(t.id)}
                    className={`flex flex-col items-center rounded-xl border py-2 text-[11px] leading-tight ${
                      t.id === tool ? "border-orange-500 bg-orange-500/15 text-orange-200" : "border-neutral-800 text-neutral-300"
                    }`}
                  >
                    <span className="text-xl">{t.icon}</span>
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-neutral-400">
                  {TOOLS.find((t) => t.id === tool)?.hint}
                  {durability && !broken && (
                    <span className="ml-2 tracking-widest text-orange-400">
                      {"●".repeat(durability.remaining)}
                      <span className="text-neutral-700">{"●".repeat(durability.total - durability.remaining)}</span>
                    </span>
                  )}
                </p>
                <button
                  onClick={() => {
                    setBroken(false);
                    setDurability(null);
                    setResetSignal((n) => n + 1);
                  }}
                  className={`shrink-0 rounded-lg px-3 py-1.5 text-sm ${
                    broken ? "bg-orange-500 font-semibold text-black" : "border border-neutral-700 text-neutral-300"
                  }`}
                >
                  {broken ? "다시 붙이기" : "원래대로"}
                </button>
              </div>
              <p className="text-[11px] text-neutral-600">
                물체를 끌면 이동 · 빈 곳을 끌면 회전 · 두 손가락(PC는 휠)으로 크기
              </p>
            </>
          )}
          <Slider label="원본 겹쳐보기" value={overlay} min={0} max={1} step={0.05} onChange={setOverlay} />

          <Picker
            title="빈 배경"
            items={job.backgrounds}
            selected={job.selection.background}
            onSelect={(bg) => patch({ selection: { background: bg } })}
            thumbnail
          />
          <Picker
            title="3D 모델"
            items={job.models}
            selected={job.selection.model}
            onSelect={(m) => patch({ selection: { model: m } })}
          />

          <details className="rounded-xl border border-neutral-800 p-3">
            <summary className="cursor-pointer text-sm font-semibold">위치 맞추기</summary>
            <div className="mt-3 flex flex-col gap-2">
              <AlignSlider k="fov" label="화각" min={30} max={90} step={1} unit="°" a={alignment} set={editAlignment} />
              <AlignSlider k="elevation" label="내려다보는 각도" min={0} max={85} step={1} unit="°" a={alignment} set={editAlignment} />
              <AlignSlider k="yaw" label="회전" min={-180} max={180} step={1} unit="°" a={alignment} set={editAlignment} />
              <AlignSlider k="scale" label="크기" min={0.5} max={1.5} step={0.01} a={alignment} set={editAlignment} />
              <AlignSlider k="offsetX" label="좌우" min={-0.3} max={0.3} step={0.005} a={alignment} set={editAlignment} />
              <AlignSlider k="offsetY" label="상하" min={-0.3} max={0.3} step={0.005} a={alignment} set={editAlignment} />
              <AlignSlider k="light" label="밝기" min={0} max={2.5} step={0.05} a={alignment} set={editAlignment} />              <div className="mt-2 flex gap-2">
                <button
                  onClick={() =>
                    editAlignment(defaultAlignment(job.photo.width, job.photo.height, v?.camera_elevation_deg))
                  }
                  className="rounded-lg border border-neutral-600 px-3 py-1.5 text-sm"
                >
                  초기화
                </button>
                <button
                  onClick={async () => {
                    setSaved("saving");
                    await patch({ alignment });
                    setSaved("saved");
                  }}
                  className="rounded-lg bg-orange-500 px-3 py-1.5 text-sm text-black"
                >
                  {saved === "saving" ? "저장 중…" : saved === "saved" ? "저장됨" : "이 위치 저장"}
                </button>
              </div>
            </div>
          </details>
        </section>
      )}

      {v && (
        <section className="rounded-xl border border-neutral-800 p-4 text-sm">
          <h2 className="mb-2 font-semibold">검증 결과 {job.verify.ms ? `· ${(job.verify.ms / 1000).toFixed(1)}초` : ""}</h2>
          <dl className="grid grid-cols-[6rem_1fr] gap-y-1 text-neutral-300">
            <dt className="text-neutral-500">판정</dt>
            <dd>{v.ok ? "통과" : "탈락"} — {v.reason}</dd>
            <dt className="text-neutral-500">재질</dt>
            <dd>
              {MATERIAL_KO[v.material] ?? v.material} · 부서지면 {FRAGILITY_KO[v.fragility] ?? v.fragility}
            </dd>
            <dt className="text-neutral-500">추정 크기</dt>
            <dd>
              {v.est_size_cm.w}×{v.est_size_cm.h}×{v.est_size_cm.d} cm
            </dd>
            <dt className="text-neutral-500">촬영 각도</dt>
            <dd>위에서 약 {Math.round(v.camera_elevation_deg)}°</dd>
            {v.difficulty_notes && (
              <>
                <dt className="text-neutral-500">주의</dt>
                <dd>{v.difficulty_notes}</dd>
              </>
            )}
          </dl>
        </section>
      )}

      {job.mask.url && (
        <section className="rounded-xl border border-neutral-800 p-4">
          <h2 className="mb-2 text-sm font-semibold">
            물체 분리 · {job.mask.source} {job.mask.ms ? `· ${(job.mask.ms / 1000).toFixed(1)}초` : ""}
          </h2>
          <div className="grid grid-cols-3 gap-2">
            {/* eslint-disable @next/next/no-img-element */}
            <img src={job.photo.url} alt="원본" className="rounded-lg" />
            <img src={job.mask.url} alt="마스크" className="rounded-lg" />
            <img
              src={job.mask.cutoutUrl}
              alt="잘라낸 물체"
              className="rounded-lg bg-[repeating-conic-gradient(#333_0_25%,#222_0_50%)] bg-[length:16px_16px]"
            />
            {/* eslint-enable @next/next/no-img-element */}
          </div>
        </section>
      )}
    </main>
  );
}

const DOT: Record<StepStatus, string> = {
  pending: "bg-neutral-700",
  running: "bg-orange-400 animate-pulse",
  done: "bg-emerald-400",
  error: "bg-red-500",
  skipped: "bg-neutral-700",
};

function Steps({ job }: { job: Job }) {
  const group = (items: Candidate[]): StepStatus => {
    if (items.length === 0) return "pending";
    if (items.some((c) => c.status === "running" || c.status === "pending")) return "running";
    return items.some((c) => c.status === "done") ? "done" : "error";
  };
  const count = (items: Candidate[]) =>
    items.length ? ` ${items.filter((c) => c.status === "done").length}/${items.length}` : "";
  const steps: [string, StepStatus][] = [
    ["검증", job.verify.status],
    ["분리", job.mask.status],
    [`빈 배경${count(job.backgrounds)}`, group(job.backgrounds)],
    [`3D${count(job.models)}`, group(job.models)],
  ];
  return (
    <ol className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {steps.map(([label, status]) => (
        <li key={label} className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${DOT[status]}`} />
          <span className={status === "pending" ? "text-neutral-500" : "text-neutral-200"}>{label}</span>
        </li>
      ))}
    </ol>
  );
}

function Picker({
  title,
  items,
  selected,
  onSelect,
  thumbnail,
}: {
  title: string;
  items: Candidate[];
  selected?: string;
  onSelect: (id: string) => void;
  thumbnail?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="mb-1.5 text-xs font-semibold text-neutral-400">{title}</h3>
      <ul className={thumbnail ? "grid grid-cols-4 gap-2" : "grid grid-cols-2 gap-2"}>
        {items.map((c) => (
          <li key={c.id}>
            <button
              disabled={c.status !== "done"}
              onClick={() => onSelect(c.id)}
              title={c.error}
              className={`w-full rounded-lg border p-1.5 text-left text-[11px] leading-tight ${
                c.id === selected ? "border-orange-500 bg-orange-500/10" : "border-neutral-800"
              } disabled:opacity-60`}
            >
              {thumbnail &&
                (c.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.url} alt="" className="mb-1 aspect-square w-full rounded object-cover" />
                ) : (
                  <div className="mb-1 aspect-square w-full rounded bg-neutral-900" />
                ))}
              <span className="block truncate">{c.label}</span>
              <span className={c.status === "error" ? "text-red-400" : "text-neutral-500"}>
                {c.status === "done"
                  ? `${((c.ms ?? 0) / 1000).toFixed(0)}초`
                  : c.status === "error"
                    ? "실패"
                    : c.status === "running"
                      ? "생성 중…"
                      : "대기"}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-3 text-xs text-neutral-300">
      <span className="w-24 shrink-0">{props.label}</span>
      <input
        type="range"
        className="flex-1"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <span className="w-12 text-right tabular-nums text-neutral-500">
        {Number.isInteger(props.step) ? props.value : props.value.toFixed(2)}
        {props.unit}
      </span>
    </label>
  );
}

function AlignSlider({
  k,
  a,
  set,
  ...rest
}: {
  k: keyof Alignment;
  a: Alignment;
  set: (a: Alignment) => void;
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
}) {
  return <Slider {...rest} value={a[k]} onChange={(value) => set({ ...a, [k]: value })} />;
}
