"use client";

import Link from "next/link";
import ObjectCard from "@/components/ui/ObjectCard";
import ScreenHeader from "@/components/ui/ScreenHeader";
import { useJobs } from "@/lib/useJobs";

/** 내 모음: everything you've photographed, two cards per row. */
export default function Collection() {
  const jobs = useJobs();
  const mine = jobs?.filter((j) => !j.sharedBy);
  return (
    <>
      <ScreenHeader title="내 모음" />
      <section className="min-h-0 flex-1 overflow-y-auto px-[23px] pt-[29px] pb-6">
        {mine && mine.length === 0 ? (
          <Link href="/" className="flex h-[231px] flex-col items-center justify-center gap-1 rounded-[16px] bg-surface text-center">
            <span className="text-[16px] font-semibold">아직 모은 물건이 없어요</span>
            <span className="text-[12px] text-primary">찍으러 가기</span>
          </Link>
        ) : (
          <ul aria-label="저장된 사진" aria-busy={jobs === null} className="grid grid-cols-2 gap-[14px]">
            {jobs === null && Array.from({ length: 6 }, (_, index) => (
              <li key={index} className="aspect-[171/231] animate-pulse rounded-[16px] bg-surface" />
            ))}
            {mine?.map((job) => (
              <li key={job.id}>
                <ObjectCard job={job} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
