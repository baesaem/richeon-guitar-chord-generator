"use client";

/**
 * 노래방 가사 시각의 재료를 곡마다 기기에 둔다 — 보컬이 부르는 구간과 받아
 * 적은 단어 시각.
 *
 * 둘 다 분석 서버가 보컬 트랙에서 잰다. 서버가 없는 수강생 기기는 가사를
 * 보컬에 맞추지 못해, 줄 시간 안에 고르게 펴다 간주 중에 가사가 흘렀다
 * (강사님: 「할아버지와 수박: 간주 중에도 가사가 나옴」). 곡 파일에 실어 보내
 * 여기 적어 두면, 수강생 기기도 강사님 기기와 똑같이 맞춘다. 곡당 몇 KB다.
 */

export interface VocalTiming {
  /** 소리 내어 부르는 구간 [시작, 끝] */
  segments: [number, number][];
  /** 받아 적은 단어와 시각(악보 없는 곡의 가사 자리) */
  words?: { text: string; start: number; end: number }[];
}

const key = (id: string) => `chordgen.vocal.${id}`;

export function getVocalTiming(id: string): VocalTiming | null {
  try {
    const v = JSON.parse(localStorage.getItem(key(id)) || "null") as VocalTiming | null;
    return v && Array.isArray(v.segments) ? v : null;
  } catch {
    return null;
  }
}

export function saveVocalTiming(id: string, v: VocalTiming): void {
  try {
    localStorage.setItem(key(id), JSON.stringify(v));
  } catch {
    // 자리가 모자라면 서버가 있을 때만 맞출 뿐이다
  }
}
