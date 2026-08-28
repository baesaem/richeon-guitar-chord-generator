"use client";

/**
 * 악보 그림 위에 덮어쓸 코드.
 *
 * 기타 악보는 짚기 쉬운 조로 옮겨 적는 일이 흔하다 — 하얀나비는 악보가
 * 사장조인데 원곡은 가장조다(카포 2프렛). 인쇄된 코드를 그대로 짚으면
 * 음원과 어긋난다. 그래서 이 음원에서 인식한 코드를 마디 자리에 맞춰
 * 얹는다.
 */

import { labelFor, transposeRoot } from "./notation";
import type { Chord } from "./types";

export interface SheetChord {
  /** 몇 번째 마디인가 */
  bar: number;
  /** 마디 안의 자리(0~1) */
  at: number;
  label: string;
}

export function sheetChords(
  bars: { start: number; end: number }[],
  chords: Chord[],
  transpose: number,
  flats: boolean,
): SheetChord[] {
  const out: SheetChord[] = [];
  let last = "";

  bars.forEach((bar, i) => {
    const span = Math.max(bar.end - bar.start, 0.05);
    for (const c of chords) {
      if (c.end <= bar.start || c.start >= bar.end) continue;
      // 스치듯 지나가는 오인식은 적지 않는다 — 악보를 덮어 가리기만 한다
      if (c.end - c.start < 0.35) continue;
      const label = labelFor(transposeRoot(c.root, transpose), c.quality, flats);
      if (!label || label.startsWith("N")) continue;
      // 바뀌는 자리만 적는다. 이어지는 코드를 마디마다 다시 적으면
      // 언제 손을 옮기는지가 오히려 안 보인다.
      if (label === last) continue;
      const at = Math.min(Math.max((c.start - bar.start) / span, 0), 0.9);
      out.push({ bar: i, at, label });
      last = label;
    }
  });

  return out;
}
