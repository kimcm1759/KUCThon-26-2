"use client";

import { useEffect, useState } from "react";
import type { Job } from "./types";

/** Every job, newest first; refreshes while any is still being made. */
export function useJobs() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let alive = true;
    const load = () =>
      fetch("/api/jobs", { cache: "no-store" })
        .then((r) => r.json())
        .then((list: Job[]) => {
          if (!alive) return;
          setJobs(list);
          if (list.some((j) => j.status === "running")) timer = setTimeout(load, 3000);
        })
        .catch(() => alive && setJobs([]));
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);
  return jobs;
}
