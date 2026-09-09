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

import type { TabScore } from "./msczToAbc";

const KEY = "chordgen.abc";

export interface AbcEntry {
  /** ABC notation 원문 */
  abc: string;
  /** 악보 첫 마디가 음원의 몇 번째 마디인지. 전주 길이가 다를 때 민다 */
  barOffset: number;
  /** 언제 넣었나 */
  at: number;
  /**
   * 음원 분석과 얼마나 다르든 **악보 코드를 따를 것인가.**
   *
   * 평소에는 열에 여덟이 맞아야 악보를 따른다 — 마디가 어긋난 악보로
   * 멀쩡한 코드를 망치지 않으려는 빗장이다. 그런데 음원 분석이 통째로
   * 빗나간 곡에서는 그 빗장 때문에 악보가 있어도 아무 도움이 안 됐다.
   * 강사님이 이 곡은 악보가 맞다고 정하면 그 빗장을 넘는다.
   */
  follow?: boolean;
  /**
   * 타브 화면에만 쓰는 악보 — 그 파일의 **기타 타브 보표**다.
   *
   * 타브 줄 위의 숫자를 멜로디 음에서 만들면 한 줄짜리 단선율이 되어,
   * 편곡자가 적은 손가락 뜯기와 전혀 다른 것이 나온다. 악보 파일에 타브
   * 보표가 들어 있으면 짚는 줄과 프렛을 적힌 그대로 담아 둔다.
   */
  tabScore?: TabScore;
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

/**
 * 악보 글을 싣는다. 타브 보표와 「악보 따르기」는 건드리지 않는다.
 *
 * 예전에는 칸을 통째로 새로 만들었다. 그래서 「ABC 수정」으로 음표
 * 하나만 고쳐도 타브가 사라져, 타브 화면이 멜로디에서 숫자를 지어내는
 * 옛 모습으로 돌아갔다. 악보를 갈아 끼우는 자리(scoreAtRegister)는
 * 새 타브를 곧바로 얹으므로 여기서 지울 까닭이 없다.
 */
export function saveAbc(songId: string, abc: string, barOffset = 0): void {
  const store = read();
  const cur = store[songId];
  store[songId] = {
    ...cur,
    abc,
    barOffset,
    at: Date.now(),
  };
  write(store);
}

/** 타브 화면에 쓸 악보(기타 타브 보표). 빈 값이면 멜로디 악보에서 만든다 */
export function setAbcTabScore(songId: string, tabScore: TabScore | null): void {
  const store = read();
  const cur = store[songId];
  if (!cur) return;
  store[songId] = { ...cur, tabScore: tabScore ?? undefined };
  write(store);
}

/** 이 곡은 악보 코드를 그대로 따를 것인지 정한다 */
export function setAbcFollow(songId: string, follow: boolean): void {
  const store = read();
  const cur = store[songId];
  if (!cur) return;
  store[songId] = { ...cur, follow };
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
