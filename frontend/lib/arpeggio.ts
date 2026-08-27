"use client";

/**
 * 아르페지오 패턴 — 기타반 유인물 「아르페지오 모음 1·2」.
 *
 * 기타 기초 탭(보기 코드로 배우기)과 코드 악보(곡의 실제 코드로 치기)가
 * 같은 패턴을 써야 하므로 여기에 둔다. 손가락 순서는 유인물 그대로다.
 *
 * 손가락 → 줄 대응은 기계적이다: 검지 3번줄, 중지 2번줄, 약지 1번줄,
 * 엄지는 그 코드 운지에서 소리 나는 가장 낮은 줄. 그래서 유인물의
 * "C·A는 5번줄, G·E·F는 6번줄, D는 4번줄" 규칙이 운지에서 저절로 나온다.
 */

import { voicingFor, type Voicing } from "@/lib/voicings";

export interface ArpPattern {
  no: number;
  /** 기타 기초 탭의 보기 코드. 두 개면 마디 앞·뒤 절반씩 */
  chords: string[];
  /** 한 마디(8분음표 8칸)의 손가락. 한 칸에 여러 손가락이면 함께 뜯는다 */
  seq: string[][];
  /** 선생님 필기 — 이 패턴을 쓰는 곡 */
  songs: string;
  note?: string;
  /** 유인물 밖에서 가져온 표준 패턴 */
  extra?: boolean;
}

const one = (fs: string) => fs.split(" ").map((f) => [f]);

export const ARP_PATTERNS: ArpPattern[] = [
  {
    no: 1, chords: ["Am"], seq: one("p i m i a i m i"),
    songs: "정녕 그대를 · 모두가 사랑이에요",
    note: "제일 많이 쓰는 패턴",
  },
  {
    no: 2, chords: ["C"], seq: one("p i m i a m i m"),
    songs: "바위섬",
  },
  {
    no: 3, chords: ["C"], seq: one("p i m i p i m i"),
    songs: "J에게 · 이젠 사랑할 수 있어요 · 그대 먼 곳에",
  },
  {
    no: 4, chords: ["C"], seq: one("p m i a m i a m"),
    songs: "친구 · 행복한 사람",
  },
  {
    no: 5, chords: ["Am", "E7"], seq: one("p i m a p i m a"),
    songs: "사랑으로 · 촛불",
  },
  {
    no: 6, chords: ["Dm"], seq: one("p i m a i m a m"),
    songs: "정녕 그대를",
  },
  {
    no: 7, chords: ["Dm"],
    seq: [["p"], ["i"], ["m", "a"], ["i"], ["p"], ["i"], ["m", "a"], ["i"]],
    songs: "새벽기차",
    note: "중지(m)·약지(a)가 2·1번줄을 함께 뜯는 변형입니다. 유인물의 타브와 다르면 유인물을 따르세요.",
  },
  {
    no: 8, chords: ["Dm"], seq: one("p i m i p i m i"),
    songs: "옛 시인의 노래",
    note: "유인물에 표시된 박에서 약지(a)로 1번줄을 함께 뜯습니다.",
  },
  // ---- 유인물 밖의 표준 패턴. 널리 가르치는 것만 골라 담았다 ----
  {
    no: 9, chords: ["C"], seq: one("p i m a m i"),
    songs: "3박(왈츠) 곡",
    note: "3/4 곡용 — 한 마디가 6칸입니다. 대표적인 왈츠 아르페지오입니다.",
    extra: true,
  },
  {
    no: 10, chords: ["Am"], seq: one("p a m i a m i m"),
    songs: "조용한 발라드",
    note: "높은 줄에서 내려오며 시작하는 하행 아르페지오입니다.",
    extra: true,
  },
  {
    no: 11, chords: ["C"], seq: one("p i m a m i m i"),
    songs: "잔잔한 발라드",
    note: "올라갔다 내려오는 상행–하행 아르페지오. 가장 부드럽게 들립니다.",
    extra: true,
  },
  {
    no: 12, chords: ["Am"],
    seq: [["p", "a"], ["i"], ["m"], ["i"], ["p", "a"], ["i"], ["m"], ["i"]],
    songs: "포크 발라드",
    note: "엄지와 약지가 근음·1번줄을 함께 집는(핀치) 패턴입니다.",
    extra: true,
  },
  {
    no: 13, chords: ["C"],
    seq: [["p"], ["i", "m", "a"], [], ["i", "m", "a"], ["p"], ["i", "m", "a"], [], ["i", "m", "a"]],
    songs: "노래 반주",
    note: "베이스를 뜯고 세 줄을 한 번에 튕깁니다. 반주가 두꺼워야 할 때 씁니다. 빈 칸은 쉼표입니다.",
    extra: true,
  },
];

export function arpPattern(no: number): ArpPattern | null {
  return ARP_PATTERNS.find((p) => p.no === no) ?? null;
}

/**
 * 이 곡에 어울리는 아르페지오 패턴. suggestStrum과 같은 태도 —
 * 정답을 안다고 하지 않고, 박자·빠르기라는 근거를 이유로 함께 내민다.
 */
export function suggestArp(
  timeSignature: string,
  bpm: number,
): { no: number; why: string } {
  const beats = parseInt(timeSignature, 10) || 4;
  if (beats === 3 || beats === 6) {
    return { no: 9, why: "3박 계열 곡이라 왈츠 아르페지오가 맞습니다" };
  }
  if (bpm > 0 && bpm <= 75) {
    return { no: 11, why: "느린 곡이라 부드러운 상행–하행이 어울립니다" };
  }
  if (bpm >= 120) {
    return { no: 3, why: "빠른 곡은 엄지가 자주 짚는 단순한 패턴이 흔들리지 않습니다" };
  }
  return { no: 1, why: "수업에서 제일 많이 쓰는 기본 패턴입니다" };
}

/** 손가락이 뜯는 줄 번호(1~6). 뮤트 줄이면 null — 그 음은 없다. */
export function arpString(finger: string, v: Voicing): number | null {
  if (finger === "p") {
    // frets[0]이 6번줄. 소리 나는 가장 낮은 줄이 근음이다
    for (let s = 0; s < 6; s++) if (v.frets[s] >= 0) return 6 - s;
    return null;
  }
  const map: Record<string, number> = { i: 3, m: 2, a: 1 };
  const str = map[finger];
  if (!str || v.frets[6 - str] < 0) return null;
  return str;
}

/** "Am"·"E7" 같은 보기 코드 이름의 운지. 기타 기초 탭 전용 */
export function exampleVoicing(name: string): Voicing | null {
  const m = name.match(/^([A-G][#♯b♭]?)(.*)$/);
  if (!m) return null;
  const root = m[1].replace("♯", "#").replace("♭", "b");
  const suffix = m[2];
  const quality =
    suffix === "m" ? "min" : suffix === "7" ? "7" : suffix === "" ? "maj" : suffix;
  return voicingFor(root, quality);
}
