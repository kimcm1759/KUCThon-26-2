import { after, type NextRequest } from "next/server";
import { runModels, runPipeline } from "@/lib/pipeline";
import { getJob, getLocalJob, READ_ONLY, updateJob } from "@/lib/store";
import type { Alignment, Job } from "@/lib/types";

export const maxDuration = 300;

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  const job = await getJob(id);
  if (!job) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(job);
}

/** Save what the viewer picked: chosen candidates, hand-tuned alignment, diary note. */
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  if (READ_ONLY || !(await getLocalJob(id))) return readOnly(id);
  const body = (await req.json()) as {
    selection?: Job["selection"];
    alignment?: Alignment;
    note?: string;
  };
  const job = await updateJob(id, (j) => {
    if (body.selection) j.selection = { ...j.selection, ...body.selection };
    if (body.alignment) j.alignment = body.alignment;
    if (typeof body.note === "string") j.note = body.note;
  });
  return Response.json(job);
}

/**
 * Re-run the pipeline; `force` skips a failed verification.
 * With `models`, only make those 3D candidates from the saved cutout.
 */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  const job = await getLocalJob(id);
  if (READ_ONLY || !job) return readOnly(id);
  if (job.status === "running") return Response.json({ error: "이미 실행 중" }, { status: 409 });
  const { force, models } = (await req.json().catch(() => ({}))) as { force?: boolean; models?: string[] };
  await updateJob(id, (j) => {
    j.status = "running";
    j.error = undefined;
  });
  after(() => (models?.length ? runModels(id, models) : runPipeline(id, { force: !!force })));
  return Response.json({ ok: true });
}

/** Samples and deployments can't be changed; 404 when the job doesn't exist at all. */
async function readOnly(id: string) {
  if (!(await getJob(id))) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ error: "샘플은 바꿀 수 없어요" }, { status: 403 });
}
