"use client";

import Link from "next/link";
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
 * Saved photos fill the Figma slots, with the object name and date below.
 */
export default function ObjectCard({ job, wide, owner, date }: { job: Job; wide?: boolean; owner?: string; date?: string }) {
  const label = job.verify.result?.label_ko ?? "확인 중";
  const title = owner ? `${owner}님의 ${label}` : label;
  const createdAt = date ?? job.createdAt;
  return (
    <Link
      href={cardHref(job)}
      className={`relative block overflow-hidden bg-surface ${
        wide ? "glass h-[231px] rounded-[16px]" : "glass aspect-[171/231] rounded-[16px]"
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={job.photo.url} alt={title} loading="lazy" className="absolute inset-0 size-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-b from-bg/20 via-transparent to-black/80" />
      <div className="absolute inset-x-3 bottom-[9px] flex items-baseline gap-[7px]">
        <p title={title} className="min-w-0 truncate text-[16px] leading-[normal] font-normal tracking-[0.8px]">{title}</p>
        <time dateTime={createdAt} className="shrink-0 text-[12px] leading-[normal] tracking-[0.6px] text-[#a19696]">{photoDate(createdAt)}</time>
      </div>
      {STATUS[job.status] && <span className="absolute top-3 left-3 rounded-full bg-black/70 px-2 py-1 text-[11px]">{STATUS[job.status]}</span>}
    </Link>
  );
}

export function photoDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(date).replaceAll("-", ".");
}
