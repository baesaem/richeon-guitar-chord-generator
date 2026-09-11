"use client";

/**
 * 음원목록의 순서와 즐겨찾기(강사님 요청).
 *
 * 폴더처럼 이 기기에만 적는다 — 곡 본문(IndexedDB)과 따로라 한쪽이 깨져도
 * 다른 쪽은 산다. 순서는 곡 id를 차례로 적은 줄이다. 그 줄에 없는 곡(새로
 * 받은 곡)은 맨 위에 새것부터 놓는다 — 새 곡이 목록 끝에 숨으면 받은 줄도
 * 모른다.
 */

const ORDER_KEY = "chordgen.songOrder";
const FAV_KEY = "chordgen.favorites";

function readList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const data = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(data) ? data.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeList(key: string, ids: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // 저장이 막혀도 이번 화면에는 지장 없다
  }
}

/** 사람이 정한 순서(곡 id 차례). 한 번도 옮기지 않았으면 빈 줄 */
export function savedOrder(): string[] {
  return readList(ORDER_KEY);
}

/** 목록 전체의 새 차례를 적는다. 지운 곡은 이 줄에서 저절로 빠진다 */
export function saveOrder(ids: string[]): string[] {
  writeList(ORDER_KEY, ids);
  return ids;
}

/** 정한 순서대로 줄 세운다. 순서에 없는 곡은 받은 차례 그대로 맨 위에 */
export function applyOrder<T extends { id: string }>(items: T[], order: string[]): T[] {
  if (!order.length) return items;
  const pos = new Map(order.map((id, i) => [id, i]));
  const fresh = items.filter((i) => !pos.has(i.id));
  const known = items
    .filter((i) => pos.has(i.id))
    .sort((a, b) => pos.get(a.id)! - pos.get(b.id)!);
  return [...fresh, ...known];
}

export function listFavorites(): string[] {
  return readList(FAV_KEY);
}

/** 즐겨찾기를 켜고 끈다. 새 목록을 돌려준다 */
export function toggleFavorite(id: string): string[] {
  const now = readList(FAV_KEY);
  const next = now.includes(id) ? now.filter((x) => x !== id) : [...now, id];
  writeList(FAV_KEY, next);
  return next;
}
