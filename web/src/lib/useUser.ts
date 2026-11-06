"use client";

import { useSyncExternalStore } from "react";
import { getUser, type User } from "./client";

const listeners = new Set<() => void>();
let cached: { raw: string | null; user: User | null } | null = null;

function snapshot(): User | null {
  const user = getUser();
  const raw = user ? JSON.stringify(user) : null;
  if (!cached || cached.raw !== raw) cached = { raw, user };
  return cached.user;
}

/** Tell useUser() readers that sign-in changed. */
export function userChanged() {
  for (const l of listeners) l();
}

/** The signed-in user; `undefined` while rendering on the server (not known yet). */
export function useUser(): User | null | undefined {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    snapshot,
    () => undefined,
  );
}
