import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { User } from "./profile";

const COOKIE = "bbagak-session";
const TTL = 7 * 24 * 60 * 60;
// Demo-only sessions, shared across hot reloads. No account database is needed.
const runtime = globalThis as typeof globalThis & { bbagakSessions?: Map<string, { user: User; expires: number }> };
const sessions = runtime.bbagakSessions ??= new Map();

export async function sessionUser(): Promise<User | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  const session = token ? sessions.get(token) : undefined;
  if (!session || session.expires <= Date.now()) return null;
  return session.user;
}

export async function openSession(user: User, secure: boolean) {
  const jar = await cookies();
  const previous = jar.get(COOKIE)?.value;
  if (previous) sessions.delete(previous);
  for (const [token, session] of sessions) if (session.expires <= Date.now()) sessions.delete(token);
  const token = randomBytes(32).toString("base64url");
  sessions.set(token, { user, expires: Date.now() + TTL * 1000 });
  jar.set(COOKIE, token, { httpOnly: true, sameSite: "strict", secure, path: "/", maxAge: TTL });
}

export async function closeSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) sessions.delete(token);
  jar.delete(COOKIE);
}
