import "server-only";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Job } from "./types";

// Local-disk store: one folder per job holding job.json and every asset.
// Good enough for a single dev server; swap for Blob + a DB before deploying.
const ROOT = path.join(process.cwd(), ".data", "jobs");

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

export async function getJob(id: string): Promise<Job | null> {
  try {
    return JSON.parse(await readFile(path.join(jobDir(id), "job.json"), "utf8"));
  } catch {
    return null;
  }
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
    const job = await getJob(id);
    if (!job) throw new Error(`job not found: ${id}`);
    fn(job);
    await putJob(job);
    return job;
  });
  locks.set(id, next.catch(() => {}));
  return next;
}

export async function listJobs(): Promise<Job[]> {
  let ids: string[];
  try {
    ids = await readdir(ROOT);
  } catch {
    return [];
  }
  const jobs = await Promise.all(ids.filter((id) => SAFE_ID.test(id)).map(getJob));
  return jobs
    .filter((j): j is Job => j !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
