"use client";

/**
 * 서버에 아직 못 보낸 곡의 명단.
 *
 * 고치는 일은 기기에 먼저 적힌다(기기가 원본). 그 자리에서 서버에도
 * 밀어 넣는데, 서버가 꺼져 있으면 못 보낸다 — 그 곡의 번호를 여기
 * 적어 두었다가, 서버가 다시 살아나면 밀어 넣고 지운다.
 */

const KEY = "chordgen.dirty";

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as string[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function markDirty(id: string): void {
  const list = read();
  if (list.includes(id)) return;
  try {
    localStorage.setItem(KEY, JSON.stringify([...list, id]));
  } catch {
    // 못 적어도 다음 수정에서 다시 시도된다
  }
}

export function clearDirty(id: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(read().filter((x) => x !== id)));
  } catch {
    // 무시
  }
}

export function listDirty(): string[] {
  return read();
}
