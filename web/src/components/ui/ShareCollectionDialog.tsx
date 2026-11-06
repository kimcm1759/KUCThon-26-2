"use client";

import { useEffect, useRef, useState } from "react";
import { photoDate } from "./ObjectCard";
import type { Job, NetworkPost } from "@/lib/types";

export default function ShareCollectionDialog({ jobs, sharedIds, onShared, onClose }: {
  jobs: Job[] | null;
  sharedIds: Set<string>;
  onShared: (post: NetworkPost) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const mine = jobs?.filter((job) => !job.sharedBy && !job.draft);
  const selectedJob = mine?.find((job) => job.id === selected);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => element?.close();
  }, []);

  async function share() {
    if (!selectedJob || selectedJob.status !== "done" || sharedIds.has(selectedJob.id) || pending) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/network", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: selectedJob.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "사진을 올리지 못했어요.");
      onShared(result as NetworkPost);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "사진을 올리지 못했어요. 다시 시도해 주세요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby="share-title"
      aria-describedby="share-description"
      onCancel={(event) => { event.preventDefault(); if (!pending) onClose(); }}
      className="fixed inset-x-0 bottom-0 top-auto mx-auto mb-0 flex max-h-[85svh] w-full max-w-[480px] flex-col rounded-t-[24px] border border-white/10 bg-bg p-6 text-white backdrop:bg-black/70"
    >
      <div className="flex shrink-0 items-center justify-between gap-3">
        <h2 id="share-title" className="text-[20px] font-semibold">내 모음에서 올리기</h2>
        <button type="button" onClick={onClose} disabled={pending} aria-label="닫기" className="-mr-2 flex size-10 items-center justify-center text-icon disabled:opacity-40">
          {/* Same 24px, #63606F and 2px weight as the back arrow (bx:arrow-back). */}
          <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 5l14 14M19 5L5 19" />
          </svg>
        </button>
      </div>
      <p id="share-description" className="mt-2 shrink-0 text-[14px] text-subtle">네트워크에 올릴 사진 하나를 선택해 주세요.</p>
      <div className="mt-5 min-h-0 flex-1 overflow-y-auto">
        {mine === undefined ? (
          <p role="status" className="py-10 text-center text-subtle">사진을 불러오는 중이에요.</p>
        ) : mine.length === 0 ? (
          <p className="py-10 text-center text-subtle">내 모음에 저장된 사진이 없어요.</p>
        ) : (
          <ul aria-label="올릴 사진 선택" className="grid grid-cols-2 gap-3">
            {mine.map((job) => {
              const alreadyShared = sharedIds.has(job.id);
              const unavailable = alreadyShared || job.status !== "done";
              const label = job.verify.result?.label_ko ?? "확인 중";
              return (
                <li key={job.id}>
                  <button
                    type="button"
                    aria-label={`${label}${alreadyShared ? " (이미 올린 사진)" : " 선택"}`}
                    aria-pressed={selected === job.id}
                    disabled={unavailable || pending}
                    onClick={() => { setSelected(job.id); setError(""); }}
                    className="relative block aspect-[171/231] w-full overflow-hidden rounded-[16px] border border-white/10 bg-surface text-left outline-offset-2 aria-pressed:border-primary aria-pressed:ring-2 aria-pressed:ring-primary disabled:opacity-50"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={job.photo.url} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/85" />
                    <div className="absolute inset-x-3 bottom-3">
                      <p className="truncate text-[14px]">{label}</p>
                      <p className="mt-1 text-[12px] text-subtle">{alreadyShared ? "이미 올린 사진" : job.status !== "done" ? "완성된 후 올릴 수 있어요" : photoDate(job.createdAt)}</p>
                    </div>
                    {selected === job.id && <span aria-hidden="true" className="absolute top-3 right-3 flex size-6 items-center justify-center rounded-full bg-primary text-white">✓</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {error && <p role="alert" className="mt-4 shrink-0 text-[13px] text-red-400">{error}</p>}
      <button
        type="button"
        onClick={share}
        disabled={!selectedJob || pending || selectedJob.status !== "done" || sharedIds.has(selectedJob.id)}
        className="mt-5 flex h-14 shrink-0 items-center justify-center rounded-[16px] bg-primary text-[16px] font-medium disabled:bg-surface disabled:text-muted"
      >
        {pending ? "올리는 중…" : "올리기"}
      </button>
    </dialog>
  );
}
