"use client";

/**
 * 음원목록에서 지운 곡의 무덤 표식.
 *
 * 서버에만 있는 곡은 자동으로 기기에 담긴다. 그런데 지운 곡까지
 * 다시 담으면 지워도 지워지지 않는 꼴이 된다 — 지운 곡의 번호를
 * 적어 두고 자동 담기에서 건너뛴다. 손수 「저장」을 누르면 다시
 * 담겠다는 뜻이니 표식을 지운다.
 */

const KEY = "chordgen.localRemoved";

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as string[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function markRemoved(id: string): void {
  const list = read();
  if (list.includes(id)) return;
  try {
    localStorage.setItem(KEY, JSON.stringify([...list, id].slice(-300)));
  } catch {
    // 못 적으면 다음 자동 담기에서 되살아날 뿐이다
  }
}

export function unmarkRemoved(id: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(read().filter((x) => x !== id)));
  } catch {
    // 무시
  }
}

export function removedIds(): Set<string> {
  return new Set(read());
}
