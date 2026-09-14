/**
 * 악보 없는 곡의 노래방 가사를 음원에 맞춘다(강사님: 「꽃보다 가사가 음원과
 * 전혀 안 맞음」).
 *
 * 악보가 없으면 가사 줄의 시작·끝만 알아, 줄 안의 글자를 고르게 폈다 — 쉬는
 * 자리에도 글자가 흐르고, 길게 끄는 음에서는 글자가 앞질렀다. 서버는 보컬을
 * 받아 적으며 단어마다 부른 시각을 남겨 둔다. 받아 적은 글은 틀리기도 하지만
 * (「쓰다듬으며」→「싸두며」) 시각은 믿을 만하다. 그래서 기기의 가사를 받아 적은
 * 글자와 한 글자씩 짝지어(편집 거리 정렬) 같은 글자로 짝이 난 자리는 그 시각에,
 * 짝이 없는 글자는 앞뒤 짝 사이에 나눠 놓는다. 받아 적은 것이 거의 없는 줄은
 * 예전처럼 줄 시간 안에 고르게 편다.
 */

import type { KaraokeSyl } from "@/lib/karaokeSyllables";
import type { LyricLine } from "@/lib/types";

export interface AsrWord {
  text: string;
  start: number;
  end: number;
}

/** 글자로 셀 것 — 띄어쓰기·문장부호는 짝짓기에서 뺀다 */
const isChar = (ch: string) => /[\p{L}\p{N}]/u.test(ch);

/** 짝이 없는 글자 사이의 간격(초) — 줄 머리·끝을 채울 때만 쓴다 */
const STEP = 0.3;
/**
 * 줄 시간 안에 고르게 펼 때 한 글자에 줄 최대 시간(초). 줄의 끝 시각이 다음 줄
 * 앞까지 늘어나 간주를 덮는 일이 잦다(「할아버지와 수박」 한 줄이 108~132초) —
 * 그대로 펴면 글자가 간주 중에 흐른다
 */
const MAX_PER_CHAR = 1.0;

export function syllablesFromWords(
  lines: ReadonlyArray<LyricLine>,
  words: ReadonlyArray<AsrWord>,
): KaraokeSyl[] {
  const sorted = lines
    .filter((l) => l.text.trim())
    .slice()
    .sort((a, b) => a.t - b.t);

  // 가사 글자 — 어느 줄인지, 뒤에 띄어 쓰는지
  const lyr: { ch: string; line: number; space: boolean }[] = [];
  sorted.forEach((l, li) => {
    const chars = [...l.text];
    chars.forEach((ch, k) => {
      if (!isChar(ch)) return;
      const next = chars.slice(k + 1).find((c) => c === " " || isChar(c));
      lyr.push({ ch, line: li, space: next === undefined || next === " " });
    });
  });

  // 받아 적은 글자와 그 시각(한 단어 안에서는 고르게)
  const asr: { ch: string; t: number }[] = [];
  for (const w of words) {
    const chars = [...(w.text ?? "")].filter(isChar);
    const span = Math.max(w.end - w.start, 0);
    chars.forEach((ch, k) =>
      asr.push({ ch, t: w.start + (span * k) / chars.length }),
    );
  }

  const n = lyr.length;
  const m = asr.length;
  if (!n || !m || n * m > 4_000_000) return [];

  /* 편집 거리 정렬. 같은 글자 +2, 다른 글자 -1, 건너뛰기 -1.
     받아 적은 쪽의 앞뒤(인사말·박수 소리를 받아 적은 것)는 거저 건너뛴다 */
  const W = m + 1;
  const score = new Int32Array((n + 1) * W);
  const move = new Uint8Array((n + 1) * W); // 1 대각, 2 가사만, 3 받아쓰기만
  for (let i = 1; i <= n; i++) {
    score[i * W] = -i;
    move[i * W] = 2;
  }
  for (let j = 1; j <= m; j++) move[j] = 3;
  for (let i = 1; i <= n; i++) {
    const a = lyr[i - 1].ch;
    for (let j = 1; j <= m; j++) {
      const d = score[(i - 1) * W + j - 1] + (a === asr[j - 1].ch ? 2 : -1);
      const u = score[(i - 1) * W + j] - 1;
      const l = score[i * W + j - 1] - 1;
      const k = i * W + j;
      if (d >= u && d >= l) {
        score[k] = d;
        move[k] = 1;
      } else if (u >= l) {
        score[k] = u;
        move[k] = 2;
      } else {
        score[k] = l;
        move[k] = 3;
      }
    }
  }
  let j = 0;
  for (let c = 1; c <= m; c++) if (score[n * W + c] > score[n * W + j]) j = c;

  // 같은 글자로 짝이 난 자리만 믿는다. 그 줄 시간에서 한참 벗어나면 버린다
  const t: (number | null)[] = new Array(n).fill(null);
  let i = n;
  while (i > 0 && j > 0) {
    const mv = move[i * W + j];
    if (mv === 1) {
      const line = sorted[lyr[i - 1].line];
      const at = asr[j - 1].t;
      if (
        lyr[i - 1].ch === asr[j - 1].ch &&
        at > line.t - 4 &&
        at < Math.max(line.end, line.t) + 4
      )
        t[i - 1] = at;
      i--;
      j--;
    } else if (mv === 2) i--;
    else j--;
  }

  // 줄마다 빈자리를 메운다
  const out: number[] = new Array(n).fill(0);
  let k0 = 0;
  sorted.forEach((line, li) => {
    const idx: number[] = [];
    while (k0 < n && lyr[k0].line === li) idx.push(k0++);
    if (!idx.length) return;
    const anchors = idx.filter((k) => t[k] !== null);
    if (anchors.length < Math.max(2, idx.length * 0.3)) {
      // 받아 적은 것이 거의 없는 줄 — 줄 시간 안에 고르게(한 글자 1초까지만)
      const span = Math.max(
        Math.min(line.end - line.t, idx.length * MAX_PER_CHAR),
        idx.length * STEP,
      );
      idx.forEach((k, q) => (out[k] = line.t + (span * q) / idx.length));
      return;
    }
    const first = anchors[0];
    const last = anchors[anchors.length - 1];
    for (const k of idx) {
      if (t[k] !== null) out[k] = t[k] as number;
      else if (k < first) out[k] = (t[first] as number) - (first - k) * STEP;
      else if (k > last) out[k] = (t[last] as number) + (k - last) * STEP;
      else {
        const a = anchors.filter((x) => x < k).pop() as number;
        const b = anchors.find((x) => x > k) as number;
        const ta = t[a] as number;
        const tb = t[b] as number;
        out[k] = ta + ((tb - ta) * (k - a)) / (b - a);
      }
    }
  });

  // 뒤 글자가 앞 글자보다 앞서지 않게
  for (let k = 1; k < n; k++) out[k] = Math.max(out[k], out[k - 1] + 0.05);

  return lyr.map((c, k) => ({
    t: +out[k].toFixed(3),
    text: c.ch,
    space: c.space,
    line: c.line,
  }));
}
