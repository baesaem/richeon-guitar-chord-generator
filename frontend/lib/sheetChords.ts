"use client";

/**
 * 악보 그림 위에 덮어쓸 코드.
 *
 * 음높이(카포)를 손대면 인쇄된 코드는 그 순간 어긋난다. 그때만 고쳐
 * 적는다 — 손대지 않았으면 악보에 적힌 대로가 옳다.
 *
 * 자리는 **악보에 적힌 코드의 자리**를 그대로 쓴다. 음원에서 코드가
 * 바뀐 시각으로 잡으면 인쇄된 글자와 어긋난 곳에 얹혀, 두 개가 나란히
 * 보이거나 엉뚱한 마디에 앉는다.
 */

import { transposeLabel, type ScoreData } from "./scoreStaff";

export interface SheetChord {
  /** 그림에서 몇 번째 마디인가 */
  bar: number;
  /** 마디 안의 자리(0~1) */
  at: number;
  label: string;
}

export function sheetChords(
  score: ScoreData | null | undefined,
  transpose: number,
  flats: boolean,
): SheetChord[] {
  if (!score?.bars?.length) return [];
  const out: SheetChord[] = [];

  score.bars.forEach((bar, i) => {
    const beats = bar.beats || 4;
    for (const c of bar.chords ?? []) {
      out.push({
        // 그림의 n번째 마디가 악보의 n번째 마디다
        bar: i,
        at: Math.min(Math.max(c.beat / beats, 0), 0.94),
        label: transposeLabel(c.label, transpose, flats),
      });
    }
  });

  return out;
}
