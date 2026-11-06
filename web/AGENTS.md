<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 부숴봐 project notes

Photo → Claude verify → SAM 3 mask → erased background + image-to-3D (fal.ai) → smash the 3D model in place inside the photo. Read README.md first; UI text is Korean.

- Job data lives in `.data/jobs/<id>/` (`job.json` + files) and is committed to git. Read and write it only through `src/lib/store.ts` (`getJob`, `listJobs`, `updateJob` serializes writes per job). Types are in `src/lib/types.ts`.
- Don't commit high-quality GLBs (`model-*-hq.glb`, `model-hunyuan3d.glb`, 15–60MB); `.gitignore` already excludes them.
- `READ_ONLY` (on Vercel) means no disk: only bundled samples (`src/lib/samples.json`, `public/samples/`). New write routes must check it, like `src/app/api/jobs/[id]/route.ts`.
- Keys are in `.env.local` (`ANTHROPIC_API_KEY`, `FAL_KEY`); never commit or print them.
- Physics, fracture and tools: `src/components/Smashable.tsx` is the hub; heavy fracture work runs in `src/lib/fracture.worker.ts`.
- Check with `npx tsc --noEmit` and `npm run lint` before committing.
