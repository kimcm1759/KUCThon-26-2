"use client";

import ObjectCard from "@/components/ui/ObjectCard";
import ScreenHeader from "@/components/ui/ScreenHeader";
import { useJobs } from "@/lib/useJobs";

/** 네트워크: objects other people shared, one wide card each. */
export default function Network() {
  const jobs = useJobs();
  const shared = jobs?.filter((j) => j.sharedBy);
  return (
    <>
      <ScreenHeader title="네트워크" />
      <section className="min-h-0 flex-1 overflow-y-auto px-[25px] pt-[81px] pb-6">
        {shared && shared.length === 0 ? (
          <div className="flex h-[231px] items-center justify-center rounded-[16px] bg-surface text-[14px] text-subtle">
            아직 공유된 물건이 없어요
          </div>
        ) : (
          <ul className="flex flex-col gap-4">
            {shared?.map((job) => (
              <li key={job.id}>
                <ObjectCard job={job} wide />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
