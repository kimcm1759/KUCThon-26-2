import "server-only";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import samples from "./samples.json";
import type { Job } from "./types";

// Local-disk store: one folder per job holding job.json and every asset.
// Good enough for a single dev server. Demo samples exported with
// scripts/export-sample.mjs are bundled (samples.json + public/samples/) and
// are all a deployment without a writable disk can show.
const ROOT = path.join(process.cwd(), ".data", "jobs");

/** On Vercel (or with READ_ONLY=1) nothing can be written: samples only. */
export const READ_ONLY = !!process.env.VERCEL || process.env.READ_ONLY === "1";

const SAMPLES = samples as Job[];

const SAFE_ID = /^[a-z0-9-]+$/i;
const SAFE_NAME = /^[a-z0-9._-]+$/i;

export function jobDir(id: string) {
  if (!SAFE_ID.test(id)) throw new Error(`bad job id: ${id}`);
  return path.join(ROOT, id);
}

export function filePath(id: string, name: string) {
  if (!SAFE_NAME.test(name)) throw new Error(`bad file name: ${name}`);
  return path.join(jobDir(id), name);
}

export function fileUrl(id: string, name: string) {
  return `/api/files/${id}/${name}`;
}

export async function saveFile(id: string, name: string, data: Buffer | Uint8Array) {
  await mkdir(jobDir(id), { recursive: true });
  await writeFile(filePath(id, name), data);
  return fileUrl(id, name);
}

/** A job on this machine's disk (editable), not a bundled sample. */
export async function getLocalJob(id: string): Promise<Job | null> {
  if (READ_ONLY) return null;
  try {
    return JSON.parse(await readFile(path.join(jobDir(id), "job.json"), "utf8"));
  } catch {
    return null;
  }
}

export async function getJob(id: string): Promise<Job | null> {
  return (await getLocalJob(id)) ?? SAMPLES.find((j) => j.id === id) ?? null;
}

export async function putJob(job: Job) {
  await mkdir(jobDir(job.id), { recursive: true });
  await writeFile(path.join(jobDir(job.id), "job.json"), JSON.stringify(job, null, 2));
}

// Candidates finish in parallel, so serialize read-modify-write per job.
const locks = new Map<string, Promise<unknown>>();

export function updateJob(id: string, fn: (job: Job) => void): Promise<Job> {
  const prev = locks.get(id) ?? Promise.resolve();
  const next = prev.then(async () => {
    const job = await getLocalJob(id);
    if (!job) throw new Error(`job not found: ${id}`);
    fn(job);
    await putJob(job);
    return job;
  });
  locks.set(id, next.catch(() => {}));
  return next;
}

export async function listJobs(): Promise<Job[]> {
  let ids: string[] = [];
  try {
    ids = await readdir(ROOT);
  } catch {
    // No local data (fresh checkout or a deployment).
  }
  const local = (await Promise.all(ids.filter((id) => SAFE_ID.test(id)).map(getLocalJob))).filter(
    (j): j is Job => j !== null,
  );
  // A job exported as a sample and still on disk shows once, as the editable local copy.
  const seen = new Set(local.map((j) => j.id));
  return [...local, ...SAMPLES.filter((j) => !seen.has(j.id))].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}
