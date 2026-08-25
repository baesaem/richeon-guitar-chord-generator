import type { AnalysisResult, Chord } from "./types";

export interface Bar {
  number: number;
  start: number;
  end: number;
  chords: Chord[];
  /** 이 마디에 속한 박의 시각. 코드악보에서 박 칸을 나누는 데 쓴다 */
  beatTimes: number[];
}

/** 비트 정보를 마디로 묶고, 각 마디에 걸치는 코드를 붙인다. */
export function buildBars(result: AnalysisResult): Bar[] {
  if (result.beats.length === 0) return [];

  const starts = new Map<number, number>();
  const beatTimes = new Map<number, number[]>();
  for (const beat of result.beats) {
    if (!starts.has(beat.bar)) starts.set(beat.bar, beat.t);
    const list = beatTimes.get(beat.bar);
    if (list) list.push(beat.t);
    else beatTimes.set(beat.bar, [beat.t]);
  }

  const numbers = [...starts.keys()].sort((a, b) => a - b);
  return numbers.map((number, i) => {
    const start = starts.get(number)!;
    const end = i + 1 < numbers.length ? starts.get(numbers[i + 1])! : result.duration;
    return {
      number,
      start,
      end,
      // 마디에 조금이라도 걸치는 코드를 모두 담는다
      chords: result.chords.filter((c) => c.start < end && c.end > start),
      beatTimes: beatTimes.get(number) ?? [start],
    };
  });
}

/** 시각 t 이전에 시작한 마지막 구간의 인덱스. 없으면 -1. */
function lastStartedAt(items: { start: number }[], t: number): number {
  let lo = 0;
  let hi = items.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].start > t) {
      hi = mid - 1;
    } else {
      found = mid;
      lo = mid + 1;
    }
  }
  return found;
}

/** 시각 t에 울리고 있는 코드의 인덱스 */
export const chordIndexAt = (chords: Chord[], t: number) => lastStartedAt(chords, t);

/** 시각 t가 속한 마디의 인덱스 */
export const barIndexAt = (bars: Bar[], t: number) => Math.max(lastStartedAt(bars, t), 0);
