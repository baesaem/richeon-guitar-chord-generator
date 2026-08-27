"use client";

import type { Chord } from "./types";

/**
 * 코드 손보기.
 *
 * 인식이 아무리 좋아져도 틀리는 마디는 남는다. 선생님이 귀로 듣고 한
 * 마디만 고칠 수 있어야 한다.
 *
 * 고치는 단위는 **마디 하나**다. 코드 구간이 여러 마디에 걸쳐 있으면
 * 그 마디만 떼어 내고 나머지는 그대로 둔다 — 한 마디를 고쳤는데 뒤
 * 여덟 마디가 같이 바뀌면 고친 사람이 놀란다.
 */

const EPS = 1e-6;

/**
 * 코드 고치기가 열리기까지 눌러야 하는 시간.
 *
 * 길다. 일부러 그렇게 뒀다 — 재생하면서 고치는 화면이라, 듣던 자리로
 * 돌아가려고 마디를 누른 것이 편집창으로 이어지면 안 된다. 누르는 동안
 * 마디가 물들어 얼마나 남았는지 보인다.
 */
export const EDIT_HOLD_MS = 3000;

/** 코드 이름에서 근음과 성질을 가른다. "C#m7" → { root: "C#", quality: "min7" } */
export function parseLabel(label: string): { root: string; quality: string } {
  const m = /^([A-G][#b♯♭]?)(.*)$/.exec(label.trim());
  if (!m) return { root: "C", quality: "maj" };
  const root = m[1].replace("♯", "#").replace("♭", "b");
  return { root, quality: qualityOf(m[2]) };
}

function qualityOf(rest: string): string {
  const t = rest.trim();
  if (t === "" ) return "maj";
  if (t === "m") return "min";
  if (t === "7") return "7";
  if (t === "maj7" || t === "M7") return "maj7";
  if (t === "m7") return "min7";
  if (t === "sus4") return "sus4";
  if (t === "sus2") return "sus2";
  if (t === "dim") return "dim";
  if (t === "aug") return "aug";
  if (t === "6") return "6";
  if (t === "m6") return "min6";
  return t;
}

/** 이 성질을 사람이 쓰는 코드 이름 꼬리로. maj면 빈 문자열 */
export function suffixOf(quality: string): string {
  const map: Record<string, string> = {
    maj: "", min: "m", "7": "7", maj7: "maj7", min7: "m7",
    sus4: "sus4", sus2: "sus2", dim: "dim", aug: "aug",
    "6": "6", min6: "m6",
  };
  return map[quality] ?? quality;
}

function make(start: number, end: number, root: string, quality: string): Chord {
  return {
    start: +start.toFixed(3),
    end: +end.toFixed(3),
    label: `${root}${suffixOf(quality)}`,
    root,
    quality,
    bass: null,
    // 사람이 정한 것이라 확신도는 최대다
    confidence: 1,
    edited: true,
  };
}

/**
 * [from, to) 구간의 코드를 새 코드로 바꾼다.
 *
 * 걸쳐 있는 구간은 잘라 낸다. 잘라 낸 조각이 너무 짧으면(한 박도 안 되면)
 * 버린다 — 화면에 이름을 적을 자리도 없는 조각이 남으면 지저분하다.
 */
export function setChordAt(
  chords: Chord[],
  from: number,
  to: number,
  root: string,
  quality: string,
): Chord[] {
  const out: Chord[] = [];
  for (const c of chords) {
    if (c.end <= from + EPS || c.start >= to - EPS) {
      out.push(c);
      continue;
    }
    // 앞쪽 남는 조각
    if (c.start < from - EPS) out.push({ ...c, end: +from.toFixed(3) });
    // 뒤쪽 남는 조각
    if (c.end > to + EPS) out.push({ ...c, start: +to.toFixed(3) });
  }
  out.push(make(from, to, root, quality));
  out.sort((a, b) => a.start - b.start);
  return mergeSame(out.filter((c) => c.end - c.start > 0.05));
}

/** 이름이 같고 맞닿은 구간을 하나로 잇는다 */
function mergeSame(chords: Chord[]): Chord[] {
  const out: Chord[] = [];
  for (const c of chords) {
    const last = out[out.length - 1];
    if (last && last.label === c.label && Math.abs(last.end - c.start) < 0.06) {
      last.end = c.end;
      last.edited = last.edited || c.edited;
      continue;
    }
    out.push({ ...c });
  }
  return out;
}
