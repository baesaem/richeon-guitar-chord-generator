import type { Chord } from "./types";

/**
 * 코드 구간 다듬기.
 *
 * 백엔드 후처리(chords.py)와 같은 규칙을 화면 쪽에도 둔다. 예전 파이프라인으로
 * 분석해 둔 곡도 다시 분석하지 않고 깨끗하게 보이게 하기 위해서다.
 */

/**
 * 같은 코드인지 판정하는 키.
 *
 * label이 아니라 근음·종류로 본다. 「기본」 표기에서 Cmaj7이 C로 낮아지면
 * 옆 C와 같은 코드가 되는데, label만 보면 그 사실을 놓친다.
 */
const key = (c: Chord) => `${c.root ?? "-"}:${c.quality}`;

/** 맞닿은 같은 코드를 하나로 잇는다. */
function mergeSame(chords: Chord[]): Chord[] {
  const out: Chord[] = [];
  for (const c of chords) {
    const prev = out[out.length - 1];
    if (prev && key(prev) === key(c)) {
      prev.end = c.end;
      prev.confidence = Math.max(prev.confidence, c.confidence);
      continue;
    }
    out.push({ ...c });
  }
  return out;
}

/**
 * 앞뒤가 같은 코드인 짧은 구간을 지운다.
 *
 * G – (반박짜리 Em7) – G 처럼 한 코드가 이어지는 중에 다른 코드가 잠깐
 * 끼는 것은 대개 오인식이다. 마디가 바뀌는 지점에서 특히 잘 생긴다.
 */
function dropSandwiched(chords: Chord[], maxDuration: number): Chord[] {
  if (chords.length < 3) return chords;

  const out: Chord[] = [{ ...chords[0] }];
  for (let i = 1; i < chords.length - 1; i++) {
    const seg = chords[i];
    const next = chords[i + 1];
    const short = seg.end - seg.start < maxDuration;
    if (short && key(out[out.length - 1]) === key(next)) {
      out[out.length - 1].end = seg.end; // 앞 코드가 그 자리를 이어받는다
      continue;
    }
    out.push({ ...seg });
  }
  out.push({ ...chords[chords.length - 1] });
  return mergeSame(out);
}

/**
 * 곡 중간의 짧은 무음(N.C.)을 앞 코드로 흡수한다.
 *
 * 소리가 잠깐 잦아들면 N.C.가 뜨지만, 연주자는 앞 코드를 그대로 짚고 있다.
 * 도입·아웃트로는 실제로 코드가 없으므로 건드리지 않는다.
 */
function absorbGaps(chords: Chord[], maxDuration: number): Chord[] {
  if (chords.length < 3) return chords;

  const out: Chord[] = [{ ...chords[0] }];
  for (let i = 1; i < chords.length - 1; i++) {
    const seg = chords[i];
    if (seg.quality === "N" && seg.end - seg.start < maxDuration) {
      out[out.length - 1].end = seg.end;
      continue;
    }
    out.push({ ...seg });
  }
  out.push({ ...chords[chords.length - 1] });
  return mergeSame(out);
}

/** 화면에 그리기 전에 코드 목록을 다듬는다. */
export function tidyChords(chords: Chord[], bpm: number): Chord[] {
  if (chords.length < 2) return chords;
  const beat = bpm > 0 ? 60 / bpm : 0.5;
  let out = mergeSame(chords);
  out = dropSandwiched(out, beat * 2.2);
  out = absorbGaps(out, beat * 2.2);
  return out;
}
