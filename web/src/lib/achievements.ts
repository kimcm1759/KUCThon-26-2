import type { Job } from "./types";

/**
 * 업적 (도감): hidden achievements for photographing one of these and playing
 * with it. Each sits in a fixed slot of the grid; every other slot is just a
 * number, like an unfilled Pokédex.
 */
export const ACHIEVEMENTS = [
  { id: "laptop", slot: 1, name: "노트북", match: /laptop|macbook|노트북/i },
  { id: "can", slot: 6, name: "캔 음료", match: /\bcan\b|캔|soda|beverage/i },
  { id: "mouse", slot: 12, name: "마우스", match: /mouse|마우스/i },
  // 책상(desk) isn't a book.
  { id: "book", slot: 17, name: "책", match: /\bbook\b|paperback|책(?!상)/i },
] as const;

/** Total grid slots (8 rows of 4, as in the Figma 업적 screen). */
export const ACHIEVEMENT_SLOTS = 32;

/** The first of the viewer's own photos that unlocks `a`: judged as that object and smashed at least once. */
export function unlockedBy(a: (typeof ACHIEVEMENTS)[number], jobs: Job[], played: (id: string) => boolean) {
  return jobs.find((j) => {
    const v = j.verify.result;
    return !j.sharedBy && j.status === "done" && v && a.match.test(`${v.label_en} ${v.label_ko}`) && played(j.id);
  });
}
