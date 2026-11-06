export interface User {
  id: string;
  nickname: string;
  email?: string;
  via: "guest" | "email" | "google" | "apple" | "kakao" | "naver";
}

export const DEMO_USER = { id: "demo-member", email: "KUCthon@korea.ac.kr", nickname: "조민재", via: "email" } as const satisfies User;
export const GUEST_USER = { id: "guest", nickname: "게스트", via: "guest" } as const satisfies User;
export const DEMO_PASSWORD = "12345678";

export function socialUser(via: string): User | null {
  const labels: Record<string, string> = { google: "Google", apple: "Apple", kakao: "카카오", naver: "네이버" };
  return Object.hasOwn(labels, via) ? { id: `social:${via}`, nickname: `${labels[via]} 사용자`, via: via as User["via"] } : null;
}

/** Read older browser sessions that used the email as their display name. */
export function restoreUser(value: unknown): User | null {
  if (!value || typeof value !== "object") return null;
  const stored = value as Partial<User> & { name?: string };
  if (stored.via === "guest") return GUEST_USER;
  if (stored.via === "email") {
    const email = stored.email ?? stored.name;
    return typeof email === "string" && email.trim().toLowerCase() === DEMO_USER.email!.toLowerCase() ? DEMO_USER : null;
  }
  return typeof stored.via === "string" ? socialUser(stored.via) : null;
}

/** Keep ownership of posts made before separate account IDs were introduced. */
export function shareOwner(share: { ownerId?: string; sharedBy: string }): string | undefined {
  if (share.ownerId) return share.ownerId;
  if (share.sharedBy === GUEST_USER.nickname) return GUEST_USER.id;
  if (share.sharedBy.trim().toLowerCase() === DEMO_USER.email!.toLowerCase() || share.sharedBy === DEMO_USER.nickname) return DEMO_USER.id;
  return undefined;
}

export function shareNickname(share: { ownerId?: string; sharedBy: string }): string {
  const owner = shareOwner(share);
  return owner === DEMO_USER.id ? DEMO_USER.nickname : owner === GUEST_USER.id ? GUEST_USER.nickname : share.sharedBy;
}
