"use client";

import type { LyricLine } from "./types";

/**
 * 가사를 문장 단위로 묶는다.
 *
 * 자동 자막은 숨 쉬는 자리마다 끊겨 두세 낱말씩 흩어진다("따스함이 너무" /
 * "그리워" / "누군가"). 그대로 늘어놓으면 어디까지가 한 소절인지 알 수 없다.
 *
 * **겹침을 신호로 쓴다.** YouTube 자막은 한 소절을 이어 부르는 동안 앞
 * 조각의 구간이 다음 조각을 덮는다 — 실측에서 이어지는 조각 사이는
 * −1.5초, −2.0초처럼 겹쳤고, 소절이 끊기는 자리에서만 0 이상으로 벌어졌다.
 * 그래서 겹치면 잇고, 벌어지면 끊는다.
 *
 * 이미 문장인 가사(가사 서비스에서 받은 것, AI로 다듬은 것)는 줄의 끝이
 * 다음 줄 시작과 같아 늘 0으로 벌어진다. 그래서 한 줄이 한 문장으로 그대로
 * 남는다 — 따로 가려낼 필요가 없다.
 */

export interface LyricGroup {
  start: number;
  end: number;
  text: string;
}

/** 한 문장이 이만큼 길어지면 끊는다. 화면 한 줄에 들어갈 만큼 */
const MAX_CHARS = 34;

export function groupBySentence(lyrics: LyricLine[]): LyricGroup[] {
  if (!lyrics.length) return [];

  const groups: LyricGroup[] = [];
  let cur: LyricGroup | null = null;

  lyrics.forEach((line, i) => {
    if (!cur) {
      cur = { start: line.t, end: line.end || line.t, text: line.text };
      return;
    }
    // 앞 조각이 이 조각을 덮고 있으면 같은 소절을 이어 부르는 중이다
    const overlaps = cur.end > line.t + 1e-3;
    const room = cur.text.length + line.text.length <= MAX_CHARS;
    if (overlaps && room) {
      cur.text = `${cur.text} ${line.text}`;
      cur.end = Math.max(cur.end, line.end || line.t);
      return;
    }
    groups.push(cur);
    cur = { start: line.t, end: line.end || line.t, text: line.text };
    void i;
  });
  if (cur) groups.push(cur);

  // 묶음의 끝은 다음 묶음 시작까지로 둔다. 화면에서 지금 줄을 짚을 때 쓴다
  return groups.map((g, i) => ({
    ...g,
    end: i + 1 < groups.length ? groups[i + 1].start : g.end,
  }));
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
