"use client";

/**
 * 오선 악보에 쓰는 계산.
 *
 * 분석 결과에는 이미 멜로디(보컬에서 딴 음정)와 가사 시각이 들어 있다.
 * 둘 다 같은 시간축 위에 있으므로, 음표를 시각대로 놓고 그 아래에 글자를
 * 붙이면 가요반주기와 같은 화면이 된다. 새로 분석할 것은 없다.
 */

import { transposeRoot } from "./notation";
import type { LyricLine, Note } from "./types";

/** 가사 한 글자가 붙은 음표. syl이 비면 간주이거나 한 글자를 끌고 가는 중이다 */
export interface StaffNote extends Note {
  syl: string;
}

// ── 조표 ────────────────────────────────────────────────────
// 값이 양수면 ♯ 개수, 음수면 ♭ 개수. 분석 결과의 조성은 늘 ♯ 이름으로
// 오므로(A# major = 내림나장조) ♯ 이름을 열쇠로 삼는다.
const MAJOR: Record<string, number> = {
  C: 0, "C#": 7, D: 2, "D#": -3, E: 4, F: -1,
  "F#": 6, G: 1, "G#": -4, A: 3, "A#": -2, B: 5,
};
const MINOR: Record<string, number> = {
  C: -3, "C#": 4, D: -1, "D#": -6, E: 1, F: -4,
  "F#": 3, G: -2, "G#": 5, A: 0, "A#": -5, B: 2,
};

const ORDER_FLAT = ["B", "E", "A", "D", "G", "C", "F"];
const ORDER_SHARP = ["F", "C", "G", "D", "A", "E", "B"];

export interface KeySignature {
  /** ♭이 붙는 음이름(적는 차례대로) */
  flats: string[];
  /** ♯이 붙는 음이름(적는 차례대로) */
  sharps: string[];
  /** 음이름을 ♭ 쪽으로 적을지 */
  useFlats: boolean;
}

/**
 * 조표를 적는 옥타브. 자리가 정해져 있다 —
 * ♭은 시4·미5·라4·레5·솔4·도5·파4, ♯은 파5·도5·솔5·레5·라4·미5·시4.
 */
export const SIG_OCTAVE: Record<"flat" | "sharp", Record<string, number>> = {
  flat: { B: 4, E: 5, A: 4, D: 5, G: 4, C: 5, F: 4 },
  sharp: { F: 5, C: 5, G: 5, D: 5, A: 4, E: 5, B: 4 },
};

/**
 * 조표. transpose(카포)만큼 옮긴 조로 계산한다 —
 * 음표가 옮겨 그려지는데 조표만 제자리면 임시표가 온통 붙는다.
 */
export function signatureOf(fifths: number): KeySignature {
  return {
    flats: fifths < 0 ? ORDER_FLAT.slice(0, -fifths) : [],
    sharps: fifths > 0 ? ORDER_SHARP.slice(0, fifths) : [],
    useFlats: fifths < 0,
  };
}


export function keySignature(musicKey: string, transpose = 0): KeySignature {
  const [rawRoot = "C", mode = "major"] = (musicKey || "C major").split(" ");
  const root = transposeRoot(rawRoot, transpose) ?? rawRoot;
  const table = /min/i.test(mode) ? MINOR : MAJOR;
  const n = table[root] ?? 0;
  return {
    flats: n < 0 ? ORDER_FLAT.slice(0, -n) : [],
    sharps: n > 0 ? ORDER_SHARP.slice(0, n) : [],
    useFlats: n < 0,
  };
}

// ── 음이름 ──────────────────────────────────────────────────
const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const LETTERS: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

/** 계이름. 다장조 기준(고정도) — 적힌 음표를 그대로 읽는 방식이다 */
export const SOLFEGE: Record<string, string> = {
  C: "도", D: "레", E: "미", F: "파", G: "솔", A: "라", B: "시",
};

export interface Spelled {
  letter: string;
  /** "", "#", "b" */
  acc: string;
  octave: number;
}

/** midi 번호를 음이름으로. 60이 가온다(C4). */
export function spellMidi(midi: number, useFlats: boolean): Spelled {
  const pc = ((midi % 12) + 12) % 12;
  const name = (useFlats ? FLAT_NAMES : SHARP_NAMES)[pc];
  return {
    letter: name[0],
    acc: name.slice(1),
    octave: Math.floor(midi / 12) - 1,
  };
}

/** 온음계 번호. 반음이 아니라 오선의 칸·줄을 세는 번호다 */
export function diatonic(sp: Spelled): number {
  return sp.octave * 7 + LETTERS[sp.letter];
}

/** 높은음자리표 맨 아랫줄(미4) */
export const BOTTOM_LINE = diatonic({ letter: "E", acc: "", octave: 4 });

/**
 * 이 곡을 몇 옥타브 올려(내려) 적을지.
 *
 * 남자 목소리는 오선 아래로 한참 내려가 덧줄투성이가 된다. 기타 악보가
 * 늘 그러듯 옥타브를 올려 적고 자리표 아래에 8을 붙이면 읽을 만해진다.
 * 오선 밖으로 나가는 음이 가장 적은 쪽을 고른다.
 */
export function pickOctave(melody: Note[]): number {
  if (melody.length === 0) return 0;
  let best = 0;
  let bestOut = Infinity;
  for (const shift of [0, 12, -12, 24, -24]) {
    let out = 0;
    for (const n of melody) {
      const d = diatonic(spellMidi(n.midi + shift, false)) - BOTTOM_LINE;
      // 0~8이 오선 안. 덧줄 한 줄(±2)까지는 봐준다.
      if (d < -2 || d > 10) out++;
    }
    if (out < bestOut) {
      bestOut = out;
      best = shift;
    }
  }
  return best;
}

// ── 가사를 음표에 붙이기 ─────────────────────────────────────

/** 노래하지 않는 글자(공백·문장부호)는 음표를 차지하지 않는다 */
const SKIP = /[\s.,!?'"()[\]{}~·…\-—:;/\\]/;

/**
 * 가사 한 줄의 글자들을 그 줄에 걸친 음표에 나눠 붙인다.
 *
 * 음표가 글자보다 적으면 긴 음표를 쪼갠다 — 같은 음을 이어 부른 것을
 * 멜로디 추출이 하나로 뭉쳐 둔 자리라, 쪼개는 편이 실제에 가깝다.
 * 그래도 모자라면 한 음표에 두 글자를 얹는다. 반대로 음표가 많으면
 * 남는 음표는 글자 없이 둔다(한 글자를 여러 음에 끌어 부른 자리다).
 */
function assign(seg: Note[], chars: string[]): StaffNote[] {
  if (seg.length === 0) return [];

  const notes = seg.map((n) => ({ ...n }));
  // 쪼개기는 글자 수까지만. 0.12초보다 짧아지면 더 쪼개도 읽히지 않는다.
  while (notes.length < chars.length) {
    let at = -1;
    let span = 0.24;
    notes.forEach((n, i) => {
      const d = n.end - n.t;
      if (d > span) {
        span = d;
        at = i;
      }
    });
    if (at < 0) break;
    const n = notes[at];
    const mid = (n.t + n.end) / 2;
    notes.splice(at, 1, { ...n, end: mid }, { ...n, t: mid });
  }

  const out: StaffNote[] = notes.map((n) => ({ ...n, syl: "" }));
  const C = chars.length;
  const N = out.length;
  for (let i = 0; i < N; i++) {
    const a = Math.floor((i * C) / N);
    const b = Math.floor(((i + 1) * C) / N);
    out[i].syl = chars.slice(a, b).join("");
  }
  return out;
}

/**
 * 멜로디에 가사를 얹는다.
 *
 * 가사는 줄 단위로만 시각이 있고 글자마다는 없다. 그런데 멜로디 음표가
 * 곧 노래한 자리이므로, 줄에 걸친 음표에 그 줄의 글자를 나눠 주면
 * 글자마다 시각을 따로 받아 적지 않아도 자리가 맞는다.
 */
export function fitLyrics(melody: Note[], lyrics?: LyricLine[]): StaffNote[] {
  const notes = [...melody].sort((a, b) => a.t - b.t);
  if (!lyrics || lyrics.length === 0) {
    return notes.map((n) => ({ ...n, syl: "" }));
  }

  const lines = [...lyrics].sort((a, b) => a.t - b.t);
  const out: StaffNote[] = [];
  let i = 0;

  for (const line of lines) {
    const chars = [...line.text].filter((ch) => !SKIP.test(ch));
    // 줄이 시작하기 전의 음표는 전주·간주다. 글자 없이 지나간다.
    // 첫 글자가 음표보다 살짝 늦게 찍히는 일이 잦아 0.2초를 앞당겨 본다.
    while (i < notes.length && notes[i].t < line.t - 0.2) {
      out.push({ ...notes[i], syl: "" });
      i++;
    }
    const seg: Note[] = [];
    while (i < notes.length && notes[i].t < line.end - 0.05) {
      seg.push(notes[i]);
      i++;
    }
    if (chars.length === 0) out.push(...seg.map((n) => ({ ...n, syl: "" })));
    else out.push(...assign(seg, chars));
  }

  while (i < notes.length) {
    out.push({ ...notes[i], syl: "" });
    i++;
  }
  return out;
}
