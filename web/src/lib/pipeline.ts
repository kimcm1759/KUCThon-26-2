import "server-only";
import { readFile } from "node:fs/promises";
import { fal } from "@fal-ai/client";
import sharp from "sharp";
import { BACKGROUNDS, MODELS, modelDefs, type CandidateContext, type CandidateDef } from "./candidates";
import { compositeInside, makeCutout, maskStats, normalizeMask, shadowMask } from "./imaging";
import { filePath, getJob, saveFile, updateJob } from "./store";
import type { Box, Candidate, Job, Verification } from "./types";
import { verifyPhoto } from "./verify";

/**
 * photo → verify (Claude) → mask (SAM 3, BiRefNet fallback)
 *       → [erase object from background ‖ image-to-3D], every candidate in parallel.
 * Each step writes its result into job.json as soon as it lands so the page can show progress.
 */
export async function runPipeline(id: string, opts: { force?: boolean } = {}) {
  try {
    if (!process.env.FAL_KEY) throw new Error("FAL_KEY가 설정되지 않았어요 (web/.env.local)");
    const job = await getJob(id);
    if (!job) throw new Error(`job not found: ${id}`);
    const photo = await readFile(filePath(id, "photo.jpg"));
    const { width: W, height: H } = job.photo;

    await updateJob(id, (j) => {
      j.status = "running";
      j.backgrounds = [];
      j.models = [];
      j.selection = {};
    });

    // 1. Verify — reuse an earlier result when re-running past a rejection.
    let verification = job.verify.result;
    if (!verification) {
      await updateJob(id, (j) => void (j.verify = { status: "running" }));
      const t = Date.now();
      try {
        verification = await verifyPhoto(photo);
      } catch (e) {
        await updateJob(id, (j) => void (j.verify = { status: "error", error: errorMessage(e) }));
        throw e;
      }
      const result = verification;
      await updateJob(id, (j) => void (j.verify = { status: "done", result, ms: Date.now() - t }));
    }
    if (!verification.ok && !opts.force) {
      await updateJob(id, (j) => void (j.status = "rejected"));
      return;
    }

    // 2. Mask
    await updateJob(id, (j) => void (j.mask = { status: "running" }));
    const t = Date.now();
    const photoUrl = await upload(photo, "image/jpeg");
    const { mask, source } = await segment(photoUrl, verification, W, H);
    const stats = await maskStats(mask);
    if (!stats) throw new Error("마스크가 비어 있어요");
    const cutout = await makeCutout(photo, mask, stats.bbox);
    const eraseMask = await shadowMask(mask, stats.bbox, W, H);
    const [maskUrl, cutoutUrl] = await Promise.all([
      saveFile(id, "mask.png", mask),
      saveFile(id, "cutout.png", cutout),
      saveFile(id, "erase-mask.png", eraseMask),
    ]);
    await updateJob(id, (j) => {
      j.mask = { status: "done", url: maskUrl, cutoutUrl, bbox: stats.bbox, source, ms: Date.now() - t };
    });

    // 3. Background + 3D candidates, all at once.
    const [falMask, falEraseMask, falCutout] = await Promise.all([
      upload(mask, "image/png"),
      upload(eraseMask, "image/png"),
      upload(cutout, "image/png"),
    ]);
    const ctx: CandidateContext = {
      photoUrl,
      maskUrl: falMask,
      eraseMaskUrl: falEraseMask,
      cutoutUrl: falCutout,
      label: verification.label_en,
      surface: verification.surface_en || "surface",
    };
    await updateJob(id, (j) => {
      j.backgrounds = BACKGROUNDS.map((d) => ({ id: d.id, label: d.label, status: "pending" }));
      j.models = MODELS.map((d) => ({ id: d.id, label: d.label, status: "pending" }));
    });
    await Promise.all([
      ...MODELS.map((d) => runModel(id, d, ctx)),
      ...BACKGROUNDS.map((d) =>
        runCandidate(id, "backgrounds", d, ctx, async (file) =>
          saveFile(id, `bg-${d.id}.png`, await compositeInside(photo, file, eraseMask)),
        ),
      ),
    ]);

    await updateJob(id, (j) => {
      j.status = "done";
      j.selection.background ??= j.backgrounds.find((c) => c.status === "done")?.id;
      j.selection.model ??= j.models.find((c) => c.status === "done")?.id;
    });
  } catch (e) {
    console.error(`[pipeline ${id}]`, e);
    await updateJob(id, (j) => {
      j.status = "error";
      j.error = errorMessage(e);
      if (j.mask.status === "running") j.mask = { status: "error", error: j.error };
    }).catch(() => {});
  }
}

/**
 * Make more 3D models for a finished job (e.g. the high-quality variants)
 * from its saved cutout, keeping the models it already has.
 */
export async function runModels(id: string, ids: string[]) {
  try {
    if (!process.env.FAL_KEY) throw new Error("FAL_KEY가 설정되지 않았어요 (web/.env.local)");
    const job = await getJob(id);
    if (!job?.verify.result || job.mask.status !== "done") throw new Error("마스크까지 끝난 작업만 돼요");
    const defs = modelDefs(ids);
    const read = (name: string) => readFile(filePath(id, name));
    const [photoUrl, maskUrl, cutoutUrl] = await Promise.all([
      read("photo.jpg").then((b) => upload(b, "image/jpeg")),
      read("mask.png").then((b) => upload(b, "image/png")),
      read("cutout.png").then((b) => upload(b, "image/png")),
    ]);
    const ctx: CandidateContext = {
      photoUrl,
      maskUrl,
      eraseMaskUrl: maskUrl,
      cutoutUrl,
      label: job.verify.result.label_en,
      surface: job.verify.result.surface_en || "surface",
    };
    await updateJob(id, (j) => {
      j.models = [
        ...j.models.filter((c) => !ids.includes(c.id)),
        ...defs.map((d) => ({ id: d.id, label: d.label, status: "pending" as const })),
      ];
    });
    await Promise.all(defs.map((d) => runModel(id, d, ctx)));
    await updateJob(id, (j) => {
      j.status = "done";
      j.selection.model ??= j.models.find((c) => c.status === "done")?.id;
    });
  } catch (e) {
    console.error(`[models ${id}]`, e);
    await updateJob(id, (j) => {
      j.status = "done";
      j.error = errorMessage(e);
    }).catch(() => {});
  }
}

function runModel(id: string, d: CandidateDef, ctx: CandidateContext) {
  return runCandidate(id, "models", d, ctx, async (file) => {
    if (file.subarray(0, 4).toString("latin1") !== "glTF") {
      throw new Error("GLB가 아닌 파일이 왔어요");
    }
    return saveFile(id, `model-${d.id}.glb`, file);
  });
}

async function runCandidate(
  id: string,
  kind: "backgrounds" | "models",
  def: CandidateDef,
  ctx: CandidateContext,
  save: (file: Buffer) => Promise<string>,
) {
  const patch = (fields: Partial<Candidate>) =>
    updateJob(id, (j: Job) => {
      const c = j[kind].find((x) => x.id === def.id);
      if (c) Object.assign(c, fields);
    });

  await patch({ status: "running" });
  const t = Date.now();
  try {
    const { data } = await fal.subscribe(def.endpoint, { input: def.input(ctx) });
    const url = def.output(data);
    if (!url) throw new Error(`결과 URL이 없어요: ${JSON.stringify(data).slice(0, 300)}`);
    const saved = await save(await download(url));
    await patch({ status: "done", url: saved, ms: Date.now() - t });
  } catch (e) {
    console.error(`[pipeline ${id}] ${def.id}`, e);
    await patch({ status: "error", error: errorMessage(e), ms: Date.now() - t });
  }
}

/**
 * SAM 3 with the object's name as the text prompt; when several instances
 * match, keep the one that best overlaps Claude's box. BiRefNet (salient
 * object) is the fallback when SAM finds nothing that fits.
 */
async function segment(photoUrl: string, v: Verification, W: number, H: number) {
  try {
    const { data } = await fal.subscribe("fal-ai/sam-3/image", {
      input: {
        image_url: photoUrl,
        prompt: v.label_en,
        apply_mask: false,
        output_format: "png",
        return_multiple_masks: true,
        max_masks: 5,
      },
    });
    const urls: string[] = (data.masks ?? []).map((m: { url: string }) => m.url);
    let best: { mask: Buffer; score: number } | null = null;
    for (const url of urls) {
      const mask = await normalizeMask(await download(url), W, H);
      const stats = await maskStats(mask);
      if (!stats) continue;
      const score = iou(stats.bbox, v.bbox);
      if (!best || score > best.score) best = { mask, score };
    }
    if (best && best.score > 0.2) return { mask: best.mask, source: "SAM 3" };
    console.warn(`[segment] SAM 3 gave ${urls.length} masks, best IoU ${best?.score ?? 0}; using BiRefNet`);
  } catch (e) {
    console.warn("[segment] SAM 3 failed; using BiRefNet", e);
  }

  const { data } = await fal.subscribe("fal-ai/birefnet/v2", {
    input: {
      image_url: photoUrl,
      model: "General Use (Heavy)",
      mask_only: true,
      output_format: "png",
    },
  });
  const raw = await download(data.image.url);
  // A mask_only result may still come back as RGBA; use alpha if it has it.
  const meta = await sharp(raw).metadata();
  const grey = meta.hasAlpha ? await sharp(raw).extractChannel("alpha").png().toBuffer() : raw;
  return { mask: await normalizeMask(grey, W, H), source: "BiRefNet" };
}

function iou(a: Box, b: Box) {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const inter = ix * iy;
  const union = (a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - inter;
  return union > 0 ? inter / union : 0;
}

async function upload(data: Buffer, type: string) {
  return fal.storage.upload(new Blob([new Uint8Array(data)], { type }));
}

async function download(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`다운로드 실패 ${res.status}: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/** fal's ApiError keeps the useful part (validation details) in `body`. */
function errorMessage(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  const body = e && typeof e === "object" && "body" in e ? e.body : undefined;
  if (!body) return message;
  return `${message}: ${typeof body === "string" ? body : JSON.stringify(body)}`.slice(0, 500);
}
