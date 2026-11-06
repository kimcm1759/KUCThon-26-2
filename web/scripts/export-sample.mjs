// Bundle a finished local job as a demo sample, so a deployment without a
// writable disk (Vercel) can show it. Copies only what the smash view needs
// into public/samples/<id>/ (images shrunk to WebP) and records the job in
// src/lib/samples.json with URLs pointing there.
//
// Usage (from web/): node scripts/export-sample.mjs <jobId>
//                    node scripts/export-sample.mjs --remove <jobId>
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const cwd = process.cwd();
const indexPath = path.join(cwd, "src", "lib", "samples.json");
const args = process.argv.slice(2);
const remove = args[0] === "--remove";
const id = remove ? args[1] : args[0];
if (!id || !/^[a-z0-9-]+$/i.test(id)) {
  console.error("usage: node scripts/export-sample.mjs [--remove] <jobId>");
  process.exit(1);
}

const samples = JSON.parse(await readFile(indexPath, "utf8"));
const outDir = path.join(cwd, "public", "samples", id);
await rm(outDir, { recursive: true, force: true });
const others = samples.filter((j) => j.id !== id);

if (remove) {
  await writeFile(indexPath, JSON.stringify(others, null, 2) + "\n");
  console.log(`removed sample ${id}`);
  process.exit(0);
}

const src = path.join(cwd, ".data", "jobs", id);
const job = JSON.parse(await readFile(path.join(src, "job.json"), "utf8"));
const bg = job.backgrounds.find((c) => c.id === job.selection.background && c.status === "done");
const model = job.models.find((c) => c.id === job.selection.model && c.status === "done");
if (job.status !== "done" || !model || !job.mask?.bbox) {
  console.error(`job ${id} isn't finished or has no chosen 3D model`);
  process.exit(1);
}

await mkdir(outDir, { recursive: true });
const url = (name) => `/samples/${id}/${name}`;
const fileOf = (u) => path.join(src, u.split("/").pop());

await copyFile(path.join(src, "photo.jpg"), path.join(outDir, "photo.jpg"));
await copyFile(fileOf(model.url), path.join(outDir, "model.glb"));
await copyFile(path.join(src, "mask.png"), path.join(outDir, "mask.png"));
await sharp(path.join(src, "cutout.png")).webp({ quality: 85 }).toFile(path.join(outDir, "cutout.webp"));
if (bg) await sharp(fileOf(bg.url)).webp({ quality: 88 }).toFile(path.join(outDir, "bg.webp"));

const sample = {
  ...job,
  sample: true,
  photo: { ...job.photo, url: url("photo.jpg") },
  mask: { ...job.mask, url: url("mask.png"), cutoutUrl: url("cutout.webp") },
  backgrounds: bg ? [{ ...bg, url: url("bg.webp") }] : [],
  models: [{ ...model, url: url("model.glb") }],
};
const next = [...others, sample].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
await writeFile(indexPath, JSON.stringify(next, null, 2) + "\n");

let total = 0;
for (const name of ["photo.jpg", "model.glb", "mask.png", "cutout.webp", ...(bg ? ["bg.webp"] : [])]) {
  total += (await stat(path.join(outDir, name))).size;
}
console.log(
  `exported ${id} (${job.verify?.result?.label_ko ?? "?"}) → public/samples/${id} (${(total / 1e6).toFixed(1)} MB)` +
    (job.alignment ? "" : " · note: no saved alignment, the default placement will be used"),
);
