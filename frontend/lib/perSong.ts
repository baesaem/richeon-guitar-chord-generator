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
  /**
   * 코드 싱크 보정(초). 양수면 코드가 더 일찍 넘어간다.
   *
   * 기기마다 소리가 나오는 시점이 다르다 — 블루투스 스피커는 소리가
   * 0.1~0.2초 늦게 나오는데 화면은 제때 넘어가니 코드가 빨라 보인다.
   * 반대로 늦게 느껴지는 기기도 있다. 곡마다 한 번 맞춰 두면 된다.
   */
  sync: number;
  /**
   * 가사 싱크 보정(초). 코드와 따로 둔다.
   *
   * 자동 자막의 시각은 말이 끝난 뒤에 찍히는 일이 잦아 코드보다 더 늦다.
   * 하나로 묶으면 한쪽을 맞출 때 다른 쪽이 틀어진다.
   */
  lyricSync: number;
  /**
   * 주법. 0 = 스트로크(리듬 슬래시), 1~ = 아르페지오 패턴 번호.
   *
   * 강사님이 곡마다 패턴을 정해 주므로 곡별 설정이다. 공유 파일에도
   * 실려 수강생 화면도 같은 패턴의 타브로 그려진다.
   */
  arp: number;
  /**
   * 직접 고른 스트로크 패턴 이름. 빈 문자열이면 자동 추천을 따른다.
   * 아르페지오와 같은 대접 — 강사님이 정한 패턴이 곡에 붙어 다닌다.
   */
  strum: string;
}

export const DEFAULT_SETUP: SongSetup = {
  transpose: 0,
  rate: 1,
  loop: null,
  sync: 0,
  lyricSync: 0,
  arp: 0,
  strum: "",
};

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
      setup.transpose === 0 &&
      setup.rate === 1 &&
      setup.loop === null &&
      setup.sync === 0 &&
      setup.lyricSync === 0 &&
      setup.arp === 0 &&
      setup.strum === "";
    if (untouched) delete all[songId];
    else all[songId] = setup;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // 저장이 막혀도 이번 재생에는 지장 없다
  }
}
