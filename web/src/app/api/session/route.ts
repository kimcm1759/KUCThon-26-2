import { DEMO_PASSWORD, DEMO_USER, GUEST_USER, socialUser } from "@/lib/profile";
import { closeSession, openSession, sessionUser } from "@/lib/session";

export async function GET() {
  return Response.json({ user: await sessionUser() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || !("via" in body) || typeof body.via !== "string") {
    return Response.json({ error: "로그인 정보를 확인해 주세요." }, { status: 400 });
  }
  let user = body.via === "guest" ? GUEST_USER : socialUser(body.via);
  if (body.via === "email") {
    if (!("email" in body) || typeof body.email !== "string" || body.email.trim().toLowerCase() !== DEMO_USER.email!.toLowerCase() || !("password" in body) || body.password !== DEMO_PASSWORD) {
      return Response.json({ error: "이메일 또는 비밀번호가 올바르지 않아요. 다시 확인해 주세요." }, { status: 401 });
    }
    user = DEMO_USER;
  }
  if (!user) return Response.json({ error: "로그인 방법을 확인해 주세요." }, { status: 400 });
  await openSession(user, new URL(req.url).protocol === "https:");
  return Response.json({ user });
}

export async function DELETE() {
  await closeSession();
  return Response.json({ ok: true });
}
