import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import samples from "./samples.json";
import type { Job, NetworkPost, NetworkShare } from "./types";
import { shareNickname, shareOwner, type User } from "./profile";

// Local-disk store: one folder per job holding job.json and every asset.
// Good enough for a single dev server. Demo samples exported with
// scripts/export-sample.mjs are bundled (samples.json + public/samples/) and
// are all a deployment without a writable disk can show.
const ROOT = path.join(process.cwd(), ".data", "jobs");
const NETWORK_FILE = path.join(process.cwd(), ".data", "network-posts.json");

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

async function readNetworkShares(): Promise<NetworkShare[]> {
  if (READ_ONLY) return [];
  try {
    const shares = JSON.parse(await readFile(NETWORK_FILE, "utf8")) as NetworkShare[];
    return shares.map((share) => ({ ...share, ownerId: shareOwner(share), sharedBy: shareNickname(share) }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** The initial feed keeps Minjae's laptop and the original orange mug. */
export async function listNetworkPosts(): Promise<NetworkPost[]> {
  const jobs = await listJobs();
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const shares = await readNetworkShares();
  const posts: NetworkPost[] = shares.flatMap((share) => {
    const job = byId.get(share.jobId);
    return job ? [{ ...share, job }] : [];
  });
  posts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const laptop = byId.get("mw51k9ky-49374c") ?? jobs.find((job) => job.verify.result?.label_ko === "노트북");
  if (laptop) {
    posts.push({
      id: "minjae-laptop",
      jobId: laptop.id,
      sharedBy: "민재",
      createdAt: laptop.createdAt,
      job: laptop,
      isDefault: true,
    });
  }
  const mug = byId.get("mw513e3w-cfdee7") ?? jobs.find((job) => job.verify.result?.label_ko === "주황색 머그컵");
  if (mug) {
    posts.push({
      id: "orange-mug",
      jobId: mug.id,
      sharedBy: mug.sharedBy ?? "빠각 팀",
      createdAt: mug.createdAt,
      job: mug,
      isDefault: true,
    });
  }
  return posts;
}

// Serialize feed writes as well, so simultaneous shares don't replace each other.
let networkWrite: Promise<unknown> = Promise.resolve();

export function addNetworkShare(jobId: string, user: User): Promise<NetworkShare> {
  const next = networkWrite.then(async () => {
    if (READ_ONLY) throw new Error("read-only network");
    const shares = await readNetworkShares();
    const existing = shares.find((share) => share.jobId === jobId && share.ownerId === user.id);
    if (existing) return existing;

    const share: NetworkShare = { id: randomUUID(), jobId, sharedBy: user.nickname, ownerId: user.id, createdAt: new Date().toISOString() };
    await mkdir(path.dirname(NETWORK_FILE), { recursive: true });
    await writeFile(NETWORK_FILE, JSON.stringify([share, ...shares], null, 2) + "\n");
    return share;
  });
  networkWrite = next.catch(() => {});
  return next;
}

/** Remove only the shared reference; the saved photo and 3D job stay intact. */
export function removeNetworkShare(id: string, ownerId: string): Promise<"deleted" | "forbidden" | "not-found"> {
  const next = networkWrite.then(async () => {
    if (READ_ONLY) throw new Error("read-only network");
    if (id === "minjae-laptop" || id === "orange-mug") return "forbidden" as const;
    const shares = await readNetworkShares();
    const share = shares.find((item) => item.id === id);
    if (!share) return "not-found" as const;
    if (share.ownerId !== ownerId) return "forbidden" as const;
    await writeFile(NETWORK_FILE, JSON.stringify(shares.filter((item) => item.id !== id), null, 2) + "\n");
    return "deleted" as const;
  });
  networkWrite = next.catch(() => {});
  return next;
}
