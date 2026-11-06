"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { lastTool, TOOL_TAG } from "@/lib/client";
import type { Job } from "@/lib/types";

const STATUS: Partial<Record<Job["status"], string>> = {
  running: "만드는 중…",
  rejected: "다시 찍어 주세요",
  error: "실패",
};

/** Where a card opens: the smash screen once there's a model (or while it's being made). */
export function cardHref(job: Job) {
  if (job.status === "rejected" || job.status === "error") return `/jobs/${job.id}`;
  return `/jobs/${job.id}/play`;
}

/**
 * One collected object: its photo, name and how it was last smashed
 * ("HAMMER · SMASH" in lime, as in the 내 모음 mock-up).
 */
export default function ObjectCard({ job, wide }: { job: Job; wide?: boolean }) {
  const tool = useSyncExternalStore(
    () => () => {},
    () => lastTool(job.id),
    () => null,
  );
  const tag = STATUS[job.status] ?? (tool ? TOOL_TAG[tool] : "TAP · SMASH");
  return (
    <Link
      href={cardHref(job)}
      className={`relative block overflow-hidden bg-surface ${
        wide ? "h-[231px] rounded-[16px]" : "aspect-[170/225] rounded-[10px]"
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={job.photo.url} alt="" className="absolute inset-0 size-full object-cover" />
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-b from-transparent to-black/85" />
      <div className="absolute inset-x-3 bottom-3">
        <p className="truncate text-[14px] font-bold">{job.verify.result?.label_ko ?? "확인 중"}</p>
        {job.sharedBy && <p className="truncate text-[11px] text-subtle">{job.sharedBy} 님이 공유</p>}
        <p className="mt-0.5 text-[10px] font-bold tracking-[0.5px] text-lime">{tag}</p>
      </div>
    </Link>
  );
}
