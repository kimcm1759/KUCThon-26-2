import { sessionUser } from "@/lib/session";
import { READ_ONLY, removeNetworkShare } from "@/lib/store";

export async function DELETE(_req: Request, context: { params: Promise<{ id: string }> }) {
  if (READ_ONLY) return Response.json({ error: "읽기 전용 시연판에서는 삭제할 수 없어요." }, { status: 403 });
  const user = await sessionUser();
  if (!user) return Response.json({ error: "다시 로그인한 후 삭제해 주세요." }, { status: 401 });
  const { id } = await context.params;
  if (!/^[a-z0-9-]+$/i.test(id)) return Response.json({ error: "게시물을 확인해 주세요." }, { status: 400 });
  try {
    const result = await removeNetworkShare(id, user.id);
    if (result === "forbidden") return Response.json({ error: "본인이 올린 게시물만 삭제할 수 있어요." }, { status: 403 });
    if (result === "not-found") return Response.json({ error: "이미 삭제되었거나 없는 게시물이에요." }, { status: 404 });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "삭제하지 못했어요. 다시 시도해 주세요." }, { status: 500 });
  }
}
