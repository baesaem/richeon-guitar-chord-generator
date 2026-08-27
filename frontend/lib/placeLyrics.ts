"use client";

import type { LyricLine } from "./types";

/**
 * 시간 표시가 없는 가사를 노래에 맞춰 놓는다.
 *
 * 붙여넣은 가사에는 시각이 없다. 노래 전체에 고르게 펴면 전주·간주까지
 * 가사가 깔려 하나도 맞지 않는다 — 4분 곡에 전주가 24초면 첫 줄부터
 * 어긋난다.
 *
 * 분석 결과에 이미 답이 있다. 보컬 트랙에서 **노래가 시작하는 자리**를
 * 뽑아 두었으니, 가사 줄을 그 자리에 하나씩 놓으면 된다.
 */

/**
 * 줄들을 노래 시작 자리에 나눠 놓는다.
 *
 * 자리가 줄보다 많으면 고르게 골라 쓴다(숨 쉬는 자리마다 하나씩 잡히므로
 * 대개 줄보다 많다). 모자라면 있는 자리를 다 쓰고 나머지는 그 사이를
 * 고르게 나눈다.
 */
export function placeOnPhrases(
  texts: string[],
  starts: number[],
  duration: number,
): LyricLine[] {
  const n = texts.length;
  if (n === 0) return [];
  if (starts.length < 2) return spreadEvenly(texts, duration);

  const times: number[] = [];
  if (starts.length >= n) {
    // 자리가 넉넉하다. 처음부터 끝까지 고르게 골라 쓴다.
    for (let i = 0; i < n; i++) {
      const at = n === 1 ? 0 : Math.round((i * (starts.length - 1)) / (n - 1));
      times.push(starts[at]);
    }
  } else {
    // 자리가 모자란다. 있는 자리를 뼈대로 삼고 사이를 나눈다.
    const span = starts[starts.length - 1] - starts[0];
    for (let i = 0; i < n; i++) {
      times.push(starts[0] + (span * i) / (n - 1));
    }
  }

  return times.map((t, i) => ({
    t: Math.round(t * 100) / 100,
    end: i + 1 < times.length ? Math.round(times[i + 1] * 100) / 100 : duration,
    text: texts[i],
  }));
}

/** 노래 자리를 모를 때. 앞뒤로 조금 비우고 고르게 편다. */
export function spreadEvenly(texts: string[], duration: number): LyricLine[] {
  const start = duration ? duration * 0.08 : 0;
  const end = duration ? duration * 0.92 : texts.length * 4;
  const step = Math.max((end - start) / Math.max(texts.length, 1), 0.5);
  return texts.map((text, i) => ({
    t: Math.round((start + i * step) * 100) / 100,
    end: Math.round((start + (i + 1) * step) * 100) / 100,
    text,
  }));
}
