// Lists public/sounds/** audio files into src/lib/sound/manifest.generated.json
// so the app knows which sounds exist without probing for 404s.
// Runs automatically before `npm run dev` and `npm run build`.
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.join(process.cwd(), "public", "sounds");
const out = path.join(process.cwd(), "src", "lib", "sound", "manifest.generated.json");
const AUDIO = /\.(mp3|ogg|wav|m4a|webm)$/i;

async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...(await walk(full)));
    else if (AUDIO.test(e.name)) files.push(path.relative(root, full).split(path.sep).join("/"));
  }
  return files;
}

const files = (await walk(root)).sort();
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, JSON.stringify({ files }, null, 2) + "\n");
console.log(`[sounds] ${files.length} file(s) listed`);
