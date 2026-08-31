"use client";

/**
 * 곡마다의 ABC 악보.
 *
 * 자동으로 딴 melody는 부른 음의 15~30%밖에 잡히지 않는다. 정식 악보를
 * ABC로 옮겨 두면 멜로디 화면이 그것을 그린다 — 음표가 하나도 빠지지 않고
 * 도돌이표와 2절 가사까지 살아 있다.
 *
 * 악보 하나가 몇 KB뿐이라 localStorage로 충분하다(결과 본문은 IndexedDB,
 * 악보는 여기 — 서로 독립이라 한쪽이 깨져도 다른 쪽은 산다).
 */

const KEY = "chordgen.abc";

export interface AbcEntry {
  /** ABC notation 원문 */
  abc: string;
  /** 악보 첫 마디가 음원의 몇 번째 마디인지. 전주 길이가 다를 때 민다 */
  barOffset: number;
  /** 언제 넣었나 */
  at: number;
}

type Store = Record<string, AbcEntry>;

function read(): Store {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Store;
  } catch {
    return {};
  }
}

function write(store: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // 저장 공간이 없으면 이번 판만 못 남긴다 — 화면은 계속 돈다
  }
}

export function getAbc(songId: string): AbcEntry | null {
  return read()[songId] ?? null;
}

export function saveAbc(songId: string, abc: string, barOffset = 0): void {
  const store = read();
  store[songId] = { abc, barOffset, at: Date.now() };
  write(store);
}

export function setAbcOffset(songId: string, barOffset: number): void {
  const store = read();
  const cur = store[songId];
  if (!cur) return;
  store[songId] = { ...cur, barOffset };
  write(store);
}

export function removeAbc(songId: string): void {
  const store = read();
  delete store[songId];
  write(store);
}

/** 악보가 붙어 있는 곡들 */
export function listAbc(): string[] {
  return Object.keys(read());
}
