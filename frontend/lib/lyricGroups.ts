"use client";

import type { Bar } from "./bars";
import type { LyricLine } from "./types";

/**
 * 가사를 마디 묶음으로 나눈다.
 *
 * 자막에서 온 가사는 숨 쉬는 자리마다 끊겨 두세 낱말씩 흩어진다. 그대로
 * 늘어놓으면 어디까지가 한 소절인지 알 수 없다.
 *
 * 악보는 한 줄에 네 마디씩 그린다. 가사도 같은 묶음으로 끊으면 "지금
 * 이 네 마디에서 이 말을 부른다"가 눈에 들어오고, 악보와 가사를 번갈아
 * 봐도 자리를 잃지 않는다.
 */

export interface LyricGroup {
  /** 이 묶음의 첫 마디 번호(사람이 세는 번호) */
  from: number;
  to: number;
  start: number;
  end: number;
  text: string;
}

export function groupByBars(
  lyrics: LyricLine[],
  bars: Bar[],
  per = 4,
): LyricGroup[] {
  if (!lyrics.length || !bars.length) return [];

  const groups: LyricGroup[] = [];
  for (let i = 0; i < bars.length; i += per) {
    const block = bars.slice(i, i + per);
    const start = block[0].start;
    const end = block[block.length - 1].end;
    // 이 묶음 안에서 시작하는 가사만 담는다. 걸쳐 있는 줄을 양쪽에 넣으면
    // 같은 말이 두 번 보인다.
    const text = lyrics
      .filter((line) => line.t >= start - 1e-3 && line.t < end - 1e-3)
      .map((line) => line.text)
      .join(" ");
    if (!text) continue; // 전주·간주는 건너뛴다
    groups.push({
      from: block[0].number,
      to: block[block.length - 1].number,
      start,
      end,
      text,
    });
  }
  return groups;
}

/** 지금 부르고 있는 묶음의 번호. 없으면 -1 */
export function groupIndexAt(groups: LyricGroup[], t: number): number {
  let found = -1;
  for (let i = 0; i < groups.length; i++) {
    if (groups[i].start <= t) found = i;
    else break;
  }
  return found;
}
