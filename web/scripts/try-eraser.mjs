// Re-run only the background step of an existing job with another eraser.
// Usage: node --env-file=.env.local scripts/try-eraser.mjs <jobId> <bria|finegrain>
import { readFile, writeFile } from "node:fs/promises";
import { fal } from "@fal-ai/client";

const [id, which = "bria"] = process.argv.slice(2);
const dir = `.data/jobs/${id}`;
const up = async (f, type) => fal.storage.upload(new Blob([await readFile(`${dir}/${f}`)], { type }));
const [image_url, mask_url] = await Promise.all([up("photo.jpg", "image/jpeg"), up("erase-mask.png", "image/png")]);
const endpoint = which === "bria" ? "fal-ai/bria/eraser" : "fal-ai/finegrain-eraser/mask";
const t = Date.now();
const { data } = await fal.subscribe(endpoint, { input: { image_url, mask_url } });
const res = await fetch(data.image.url);
await writeFile(`${dir}/try-${which}.png`, Buffer.from(await res.arrayBuffer()));
console.log(which, "done in", ((Date.now() - t) / 1000).toFixed(1), "s");
