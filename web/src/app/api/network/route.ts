import type { NextRequest } from "next/server";
import { addNetworkShare, getJob, listNetworkPosts, READ_ONLY } from "@/lib/store";
import { sessionUser } from "@/lib/session";

export async function GET() {
  return Response.json(await listNetworkPosts(), { headers: { "Cache-Control": "no-store" } });
}

/** Share the existing photo and model; no upload or generation is needed. */
export async function POST(req: NextRequest) {
  if (READ_ONLY) {
    return Response.json({ error: "이 배포판은 읽기 전용이라 사진을 올릴 수 없어요." }, { status: 403 });
  }
  const user = await sessionUser();
  if (!user) return Response.json({ error: "다시 로그인한 후 사진을 올려 주세요." }, { status: 401 });

  const body: unknown = await req.json().catch(() => null);
  if (
    !body || typeof body !== "object" ||
    !("jobId" in body) || typeof body.jobId !== "string" || !/^[a-z0-9-]+$/i.test(body.jobId)
  ) {
    return Response.json({ error: "올릴 사진과 사용자 정보를 확인해 주세요." }, { status: 400 });
  }

  const job = await getJob(body.jobId);
  if (!job) return Response.json({ error: "사진을 찾을 수 없어요." }, { status: 404 });
  if (job.sharedBy || job.status !== "done") {
    return Response.json({ error: "내 모음에서 완성된 물건을 선택해 주세요." }, { status: 400 });
  }

  try {
    const share = await addNetworkShare(job.id, user);
    return Response.json({ ...share, job });
  } catch {
    return Response.json({ error: "사진을 올리지 못했어요. 다시 시도해 주세요." }, { status: 500 });
  }
}
