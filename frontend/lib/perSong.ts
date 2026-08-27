"use client";

/**
 * 곡마다의 연주설정.
 *
 * 카포를 3프렛에 맞추고 빠르기를 0.8배로 낮춰 연습하다 앱을 닫으면, 다음에
 * 그 곡을 열 때 처음부터 다시 맞춰야 했다. 곡마다 마지막 설정을 기억해
 * 두었다가 열 때 그대로 되살린다.
 *
 * 곡 하나에 몇 바이트뿐이라 localStorage로 충분하다(결과 본문은 IndexedDB,
 * 설정은 여기 — 서로 독립이라 한쪽이 깨져도 다른 쪽은 산다).
 */

const KEY = "chordgen.perSong";

export interface SongSetup {
  /** 음높이 +n = 카포 n프렛 */
  transpose: number;
  /** 재생 속도 배율 */
  rate: number;
  /** 구간 반복. 없으면 null */
  loop: { a: number; b: number } | null;
}

export const DEFAULT_SETUP: SongSetup = { transpose: 0, rate: 1, loop: null };

function readAll(): Record<string, SongSetup> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const data = JSON.parse(raw) as Record<string, SongSetup>;
    return typeof data === "object" && data ? data : {};
  } catch {
    return {};
  }
}

/** 이 곡에 저장해 둔 설정. 없으면 기본값. */
export function loadSetup(songId: string): SongSetup {
  const saved = readAll()[songId];
  return saved ? { ...DEFAULT_SETUP, ...saved } : { ...DEFAULT_SETUP };
}

/**
 * 이 곡의 설정을 저장한다. 기본값 그대로면 지운다 —
 * 손대지 않은 곡까지 목록에 쌓아 둘 이유가 없다.
 */
export function saveSetup(songId: string, setup: SongSetup): void {
  try {
    const all = readAll();
    const untouched =
      setup.transpose === 0 && setup.rate === 1 && setup.loop === null;
    if (untouched) delete all[songId];
    else all[songId] = setup;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // 저장이 막혀도 이번 재생에는 지장 없다
  }
}
