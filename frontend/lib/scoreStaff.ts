"use client";

/**
 * 정식 악보를 오선 화면이 쓰는 모양으로 바꾼다.
 *
 * 악보는 「11마디 1박」으로 적혀 있고 화면은 「몇 초」로 그린다.
 * 서버가 이어 둔 표(score_align)가 마디마다 시작·끝 시각을 알려 주므로,
 * 마디 안에서는 박 자리에 비례해 놓으면 된다.
 */

import { labelFor, transposeRoot } from "./notation";
import { chordIndexAt, type Bar } from "./bars";
import type { StaffNote } from "./staff";
import type { Chord, LyricLine, Note } from "./types";
import { fitLyrics } from "./staff";

export interface ScoreNote {
  beat: number;
  /** 몇 박 울리는가(붙임줄로 이어진 만큼 합쳐져 있다) */
  dur: number;
  midi: number;
  /** 1절 가사 한 음절 */
  syl: string;
  /** 절마다의 가사. 절마다 다른 대목만 채워져 있다 */
  syls?: string[];
  tie: boolean;
  /** 악보에 적힌 길이(박). 음표 모양은 이것으로 정한다 */
  head: number;
  /** 잇단음표 비율(셋잇단이면 2/3) */
  tuplet: number;
}

export interface ScoreRest {
  beat: number;
  dur: number;
  tuplet: number;
}

export interface ScoreBar {
  number: number;
  beats: number;
  notes: ScoreNote[];
  rests: ScoreRest[];
  chords: { beat: number; label: string }[];
}

export interface ScoreData {
  title: string;
  composer: string;
  source: string;
  fifths: number;
  time_signature: string;
  bpm: number;
  verses: number;
  bars: ScoreBar[];
}

export interface ScoreAlign {
  /** 악보를 몇 반음 올려야 음원과 같은 소리인가 */
  shift: number;
  passes: {
    /** 이 바퀴가 몇 절인가(0=1절) */
    verse: number;
    anchors: number;
    start: number;
    end: number;
    bars: { number: number; start: number; end: number }[];
  }[];
  checks: { pass: number; bar: number; off: number }[];
}

/** 화면이 그리는 마디 하나 */
export interface ViewBar {
  number: number;
  start: number;
  end: number;
  chords: { t: number; label: string }[];
  /** 쉼표. 어디서 쉬는지 보이지 않으면 리듬을 읽을 수 없다 */
  rests: { t: number; end: number; value: number; dots: number }[];
  /** 서버가 「가사가 어긋난다」고 표시한 마디인가 */
  off?: number;
}

/**
 * 「몇 박」을 악보에 적히는 음표 값으로 되돌린다.
 *
 * 셋잇단은 눌린 길이라 비율로 먼저 되돌린 뒤 잰다 — 셋잇단8분음표는
 * 0.333박이지만 그리기는 8분음표(0.5)로 그린다.
 */
export function notated(beats: number, tuplet = 1): { value: number; dots: number } {
  const base = tuplet > 0 ? beats / tuplet : beats;
  let best = { value: 1, dots: 0 };
  let gap = Infinity;
  for (const value of [4, 2, 1, 0.5, 0.25, 0.125]) {
    for (const dots of [0, 1, 2]) {
      const d = Math.abs(base - value * (2 - 0.5 ** dots));
      if (d < gap) {
        gap = d;
        best = { value, dots };
      }
    }
  }
  return best;
}

/** 화면이 그리는 음표 하나 */
export type ViewNote = StaffNote & {
  tie?: boolean;
  /** 음표 값(4=온음표, 1=4분음표, 0.5=8분음표…). 없으면 4분음표 모양 */
  value?: number;
  dots?: number;
  triplet?: boolean;
};

export interface StaffView {
  bars: ViewBar[];
  notes: ViewNote[];
  /** 악보에서 온 것인가(아니면 뽑아낸 멜로디) */
  fromScore: boolean;
}

const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const FLAT = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];

/**
 * 코드 이름을 그대로 옮긴다.
 *
 * 뿌리·성질로 쪼개 다시 짓지 않는다 — 악보에 적힌 이름(Cm6, Fsus4 …)이
 * 강사님이 정한 것이라, 알아보는 이름만 남기고 나머지를 버리면 곤란하다.
 */
export function transposeLabel(label: string, semitones: number, flats: boolean): string {
  if (!label) return label;
  const move = (root: string): string => {
    let pc = PC[root[0]];
    if (pc === undefined) return root;
    for (const ch of root.slice(1)) {
      if (ch === "♯" || ch === "#") pc += 1;
      else if (ch === "♭" || ch === "b") pc -= 1;
    }
    pc = (((pc + semitones) % 12) + 12) % 12;
    return (flats ? FLAT : SHARP)[pc];
  };
  // 분수코드는 뿌리와 베이스를 따로 옮긴다
  return label
    .split("/")
    .map((part) => {
      const m = /^([A-G][♯♭#b]*)(.*)$/.exec(part);
      return m ? move(m[1]) + m[2] : part;
    })
    .join("/");
}

/** 지금 시각이 몇 바퀴째인가. 되풀이하는 곡은 악보 한 벌을 여러 번 쓴다. */
export function passAt(align: ScoreAlign, time: number): number {
  for (let i = 0; i < align.passes.length; i++) {
    const p = align.passes[i];
    if (time < p.end || i === align.passes.length - 1) return i;
  }
  return 0;
}

/** 정식 악보 → 화면이 그리는 모양 */
export function viewFromScore(
  score: ScoreData,
  align: ScoreAlign,
  pass: number,
  transpose: number,
  flats: boolean,
): StaffView {
  const p = align.passes[Math.min(Math.max(pass, 0), align.passes.length - 1)];
  const off = new Map(
    align.checks.filter((c) => c.pass === pass).map((c) => [c.bar, c.off]),
  );
  const shift = align.shift + transpose;
  // 2절을 부르는데 1절 글자가 뜨면 화면과 노래가 딴소리를 한다.
  // 절마다 다른 대목만 따로 적혀 있으므로, 없으면 1절로 되돌아간다.
  const verse = p.verse ?? 0;

  const bars: ViewBar[] = [];
  const notes: ViewNote[] = [];
  const byNumber = new Map(score.bars.map((b) => [b.number, b]));

  for (const slot of p.bars) {
    const src = byNumber.get(slot.number);
    if (!src) continue;
    const span = Math.max(slot.end - slot.start, 0.05);
    const at = (beat: number) => slot.start + (span * beat) / src.beats;

    bars.push({
      number: slot.number,
      start: slot.start,
      end: slot.end,
      chords: src.chords.map((c) => ({
        t: at(c.beat),
        label: transposeLabel(c.label, shift, flats),
      })),
      rests: (src.rests ?? []).map((r) => ({
        t: at(r.beat),
        end: at(Math.min(r.beat + r.dur, src.beats)),
        ...notated(r.dur, r.tuplet),
      })),
      off: off.get(slot.number),
    });

    let inTuplet = false;
    for (const n of src.notes) {
      const tuplet = (n.tuplet ?? 1) !== 1;
      notes.push({
        t: at(n.beat),
        end: at(Math.min(n.beat + n.dur, src.beats)),
        midi: n.midi + align.shift,
        syl: n.syls?.[verse] || n.syl,
        tie: n.tie,
        ...notated(n.head, n.tuplet),
        // 「3」은 묶음마다 하나만. 음표마다 붙이면 숫자가 악보를 덮는다.
        triplet: tuplet && !inTuplet,
      });
      inTuplet = tuplet;
    }
  }

  return { bars, notes, fromScore: true };
}

/** 뽑아낸 멜로디 → 화면이 그리는 모양(악보가 없을 때) */
export function viewFromMelody(
  bars: Bar[],
  chords: Chord[],
  melody: Note[],
  lyrics: LyricLine[] | undefined,
  transpose: number,
  flats: boolean,
): StaffView {
  return {
    bars: bars.map((bar, i) => ({
      number: bar.number,
      start: bar.start,
      end: bar.end,
      chords: bar.chords
        .filter((c) => {
          const start = Math.max(c.start, bar.start);
          if (c.start >= bar.start) return true;
          // 앞 마디에서 이어지는 코드는 화면 첫 마디에서만 다시 적는다
          return i === 0 || chordIndexAt(chords, start - 0.001) !== chordIndexAt(chords, start + 0.001);
        })
        .map((c) => ({
          t: Math.max(c.start, bar.start),
          label: labelFor(transposeRoot(c.root, transpose), c.quality, flats),
        })),
      rests: [],
    })),
    notes: fitLyrics(melody, lyrics),
    fromScore: false,
  };
}
