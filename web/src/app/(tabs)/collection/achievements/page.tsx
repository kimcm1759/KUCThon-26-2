"use client";

import Link from "next/link";
import ScreenHeader from "@/components/ui/ScreenHeader";
import { ACHIEVEMENT_SLOTS, ACHIEVEMENTS, unlockedBy } from "@/lib/achievements";
import { lastTool } from "@/lib/client";
import { useJobs } from "@/lib/useJobs";

const TILE =
  "relative flex aspect-square items-center justify-center overflow-hidden rounded-[16px] border bg-gradient-to-b from-[rgba(24,23,28,0.2)] to-[rgba(80,76,95,0.2)]";

/**
 * 업적 (Figma, the second 내 모음 frame): a 4-column grid like a Pokédex.
 * Hidden achievements fill in with the photo that unlocked them; every other
 * slot only shows its number.
 */
export default function Achievements() {
  const jobs = useJobs();
  const played = (id: string) => lastTool(id) !== null;
  const bySlot = new Map<number, (typeof ACHIEVEMENTS)[number]>(ACHIEVEMENTS.map((a) => [a.slot, a]));

  return (
    <>
      <ScreenHeader
        title="업적"
        back="/collection"
        action={
          <span className="flex size-9 items-center justify-center" aria-hidden>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/figma/encyclopedia.svg" alt="" width={25} height={28} className="block" />
          </span>
        }
      />
      <section className="min-h-0 flex-1 overflow-y-auto px-[25px] pt-[29px] pb-6">
        <ul aria-label="업적" className="grid grid-cols-4 gap-x-[11px] gap-y-[14px]">
          {Array.from({ length: ACHIEVEMENT_SLOTS }, (_, i) => {
            const no = String(i + 1).padStart(3, "0");
            const a = bySlot.get(i + 1);
            const job = a && jobs ? unlockedBy(a, jobs, played) : undefined;
            if (a && job) {
              return (
                <li key={i}>
                  <Link
                    href={`/jobs/${job.id}/play`}
                    aria-label={`${no} ${a.name} 달성`}
                    title={a.name}
                    className={`${TILE} border-primary`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={job.mask.cutoutUrl ?? job.photo.url}
                      alt=""
                      className={`size-full ${job.mask.cutoutUrl ? "object-contain p-[10px]" : "object-cover"}`}
                    />
                    <span className="absolute bottom-[5px] left-[8px] text-[10px] tracking-[0.5px] text-primary">{no}</span>
                  </Link>
                </li>
              );
            }
            return (
              <li key={i} aria-label={`${no} 미달성`} className={`${TILE} border-white/10`}>
                <span className="text-[12px] tracking-[0.6px] text-icon/70">{no}</span>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
