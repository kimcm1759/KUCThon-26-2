import { randomUUID } from "node:crypto";
import { after, type NextRequest } from "next/server";
import sharp from "sharp";
import { runPipeline } from "@/lib/pipeline";
import { listJobs, putJob, READ_ONLY, saveFile } from "@/lib/store";
import type { Job } from "@/lib/types";

// 3D generation can take a couple of minutes and runs inside after().
export const maxDuration = 300;

export async function GET() {
  return Response.json(await listJobs());
}

export async function POST(req: NextRequest) {
  if (READ_ONLY) {
    return Response.json({ error: "이 배포판은 시연용 샘플만 볼 수 있어요" }, { status: 403 });
  }
  const form = await req.formData();
  const photo = form.get("photo");
  if (!(photo instanceof File)) {
    return Response.json({ error: "photo 필드가 없습니다" }, { status: 400 });
  }

  // Bake EXIF rotation in and cap the size every downstream model works with.
  const jpeg = await sharp(Buffer.from(await photo.arrayBuffer()))
    .rotate()
    .resize(1536, 1536, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 92 })
    .toBuffer();
  const { width, height } = await sharp(jpeg).metadata();

  const id = `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
  const job: Job = {
    id,
    createdAt: new Date().toISOString(),
    status: "running",
    photo: { url: await saveFile(id, "photo.jpg", jpeg), width: width!, height: height! },
    verify: { status: "pending" },
    mask: { status: "pending" },
    backgrounds: [],
    models: [],
    selection: {},
  };
  await putJob(job);

  after(() => runPipeline(id));
  return Response.json({ id });
}
