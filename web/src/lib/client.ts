"use client";

import type { ToolId } from "./tools";
import { restoreUser, type User } from "./profile";
export type { User } from "./profile";

/**
 * Browser-only helpers: the signed-in name (no real accounts yet, the
 * onboarding just remembers who you said you are), photo upload, and the
 * last tool each object was smashed with. Storage can be unavailable
 * (private mode), so every read and write is guarded.
 */

const USER_KEY = "bbagak:user";
const toolKey = (id: string) => `bbagak:lastTool:${id}`;

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Not saved; the app still works for this visit.
  }
}

export function getUser(): User | null {
  const raw = read(USER_KEY);
  try {
    return raw ? restoreUser(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function setUser(user: User | null) {
  write(USER_KEY, user ? JSON.stringify(user) : null);
}

export async function signIn(user: User, password?: string): Promise<User> {
  const response = await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ via: user.via, email: user.email, password }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "로그인하지 못했어요. 다시 시도해 주세요.");
  return result.user as User;
}

export async function signOut() {
  const response = await fetch("/api/session", { method: "DELETE" });
  if (!response.ok) throw new Error("로그아웃하지 못했어요. 다시 시도해 주세요.");
}

/** "TOOL · ACTION" tags under collection cards, after how it was last smashed. */
export const TOOL_TAG: Record<ToolId, string> = {
  hammer: "HAMMER · SMASH",
  bat: "BAT · SWING",
  press: "PRESS · CRUSH",
  laser: "LASER · CUT",
  bomb: "BOMB · EXPLODE",
};

export function lastTool(id: string): ToolId | null {
  return read(toolKey(id)) as ToolId | null;
}

export function rememberTool(id: string, tool: ToolId) {
  write(toolKey(id), tool);
}

/** Phone photos are 4–12 MB; the pipeline uses at most 1536px. */
export async function shrink(source: Blob | HTMLCanvasElement, max = 1536): Promise<Blob> {
  const bitmap =
    source instanceof Blob ? await createImageBitmap(source, { imageOrientation: "from-image" }) : source;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("이미지 변환 실패"))), "image/jpeg", 0.92),
  );
}

/** Upload a photo and start the pipeline; resolves to the new job id. */
/** A draft (straight from the camera) stays out of 내 모음 until it's kept with 저장. */
export async function uploadPhoto(photo: Blob, { draft = false } = {}): Promise<string> {
  const form = new FormData();
  form.append("photo", await shrink(photo), "photo.jpg");
  if (draft) form.append("draft", "1");
  const res = await fetch("/api/jobs", { method: "POST", body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `업로드 실패 (${res.status})`);
  return body.id as string;
}
