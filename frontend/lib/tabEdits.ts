/**
 * 손으로 고친 타브 자리를 기기에 담아 둔다.
 *
 * 예전에는 ABC 악보 칸(abcStore) 안에 얹어 두었다. 그런데 타브는 그림
 * 악보에서 오고 ABC는 악보 파일에서 오는 딴 것이라, 악보를 붙이지 않은
 * 곡에서는 담을 칸 자체가 없어 고칠 수도, 「숫자 넣기」를 누를 수도
 * 없었다. 제 칸을 준다.
 */

const KEY = "chordgen.tabedits";

/** 마디 하나를 손으로 고친 내용 */
export interface TabBarEdit {
  /**
   * 이 마디의 자리를 통째로 새로 적은 것. 없으면 그림에서 읽은 대로.
   *
   * 「10-60,20,30」처럼 적는다 — 첫 글자가 줄(1번이 맨 윗줄), 나머지가
   * 프렛, 한 자리에 겹쳐 짚는 것은 -로 잇고, 자리는 쉼표로 나눈다.
   */
  cols?: { units: number; frets: { string: number; fret: number }[] }[];
  /** 이 마디에 적을 코드 이름들. 없으면 그림·악보의 것을 쓴다 */
  chords?: string[];
  /** 자리를 박 길이대로 놓는다. 없으면 고르게 나눈다 */
  beat?: boolean;
  /** 빈 자리를 끼울 자리 번호들. 그 앞이 한 칸씩 벌어진다 */
  gaps?: number[];
  /** 자리마다 반 칸씩 미는 값. 왼쪽이 음수 */
  nudge?: Record<number, number>;
}

type Store = Record<string, Record<number, TabBarEdit>>;

function read(): Store {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Store;
  } catch {
    return {};
  }
}

export function getTabEdits(
  songId: string,
): Record<number, TabBarEdit> | undefined {
  const one = read()[songId];
  if (one && Object.keys(one).length) return one;
  /* 예전에는 ABC 악보 칸 안에 얹어 두었다. 거기 남은 것이 있으면 이쪽으로
     옮겨 온다 — 한 번 옮기면 다시 볼 일이 없다 */
  const moved = legacy(songId);
  if (moved) {
    setTabEdits(songId, moved);
    return moved;
  }
  return undefined;
}

/** 옛 자리(chordgen.abc의 tabEdits)에 남은 것 */
function legacy(songId: string): Record<number, TabBarEdit> | undefined {
  if (typeof localStorage === "undefined") return undefined;
  try {
    const store = JSON.parse(localStorage.getItem("chordgen.abc") ?? "{}") as Record<
      string,
      { tabEdits?: Record<number, TabBarEdit> }
    >;
    const one = store[songId]?.tabEdits;
    return one && Object.keys(one).length ? one : undefined;
  } catch {
    return undefined;
  }
}

/** 고친 자리를 적어 둔다. 빈 값이면 그 곡의 줄을 지운다 */
export function setTabEdits(
  songId: string,
  edits: Record<number, TabBarEdit>,
): void {
  const store = read();
  if (Object.keys(edits).length) store[songId] = edits;
  else delete store[songId];
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // 자리가 모자라면 이번 판만 못 남긴다 — 화면은 계속 돈다
  }
}
