"use client";

import Link from "next/link";
import { useJobs } from "@/lib/useJobs";

/** Every job with a link to its pipeline page (candidates, alignment, re-runs). */
export default function Dev() {
  const jobs = useJobs();
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-[25px] py-8">
      <Link href="/settings" className="text-[12px] text-muted">
        ← 설정
      </Link>
      <h1 className="text-[24px] font-semibold tracking-[1.2px]">파이프라인 결과</h1>
      <ul className="flex flex-col gap-2">
        {jobs?.map((j) => (
          <li key={j.id} className="flex items-center gap-2">
            <Link href={`/jobs/${j.id}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-[16px] bg-surface p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={j.photo.url} alt="" className="size-12 rounded-[10px] object-cover" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium">{j.verify.result?.label_ko ?? "확인 중"}</span>
                <span className="block text-[11px] text-muted">
                  {j.status} · {j.id}
                </span>
              </span>
            </Link>
            {j.status === "done" && (
              <Link href={`/jobs/${j.id}/play?sync`} className="shrink-0 rounded-[16px] bg-surface p-3 text-[12px] text-primary">
                소리 맞추기
              </Link>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
