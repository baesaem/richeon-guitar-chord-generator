"use client";

/** 최근 재생 기록 (localStorage). 홈 대시보드에 보여준다. */

const KEY = "chordgen.recent";
const MAX = 10;

export interface RecentEntry {
  id: string;
  title: string;
  /** 재생한 시각 (ms) */
  at: number;
}

export function listRecent(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const rows = JSON.parse(raw) as RecentEntry[];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

/** 최근 재생에서 뺀다 — 곡을 지울 때 */
export function removeRecent(id: string): void {
  try {
    const rows = listRecent();
    if (!rows.some((r) => r.id === id)) return;
    localStorage.setItem(KEY, JSON.stringify(rows.filter((r) => r.id !== id)));
  } catch {
    // 못 지우면 홈에 한동안 남을 뿐이다
  }
}

/** 곡을 열 때 호출. 같은 곡은 맨 앞으로 끌어올린다. */
export function addRecent(id: string, title: string): void {
  try {
    const rows = listRecent().filter((r) => r.id !== id);
    rows.unshift({ id, title, at: Date.now() });
    localStorage.setItem(KEY, JSON.stringify(rows.slice(0, MAX)));
  } catch {
    // 저장이 막혀도 재생에는 지장 없다
  }
}
