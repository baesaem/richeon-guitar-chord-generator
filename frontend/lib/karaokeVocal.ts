/**
 * 노래방 가사 글자를 보컬이 실제로 부르는 자리에 맞춘다(강사님: 「음원의 보컬을
 * 참고해 가사를 표시, 지금 간주 중에도 가사가 나옴」).
 *
 * 악보(ABC)나 받아쓰기로 놓은 글자는 대개 맞지만, 악보와 음원이 어긋난 대목 —
 * 라이브에서 간주를 늘렸거나 되풀이를 줄인 자리 — 에서는 간주 중에 가사가
 * 흐른다. 「가족사진」 끝의 「피우길」은 악보대로 다섯 번 깔렸는데 가수는 세 번만,
 * 그것도 3초씩 일찍 불렀다 — 나머지는 간주 한가운데 흘렀다.
 *
 * 서버가 보컬 트랙에서 잰 「부르는 구간」에 **소절째** 맞춘다. 글자 하나하나를
 * 음 시작에 짝짓는 길은 버렸다 — 이어 부르는(레가토) 소절은 음 시작이 소절에
 * 하나뿐이라 글자가 떨어져 나갔다.
 *
 * - 1.2초 넘게 쉬는 곳에서 소절을 나눈다
 * - 이미 60% 넘게 부르는 구간 안이면 그대로 둔다
 * - 아니면 앞뒤 6초 안에서 소절째 옮겨 가장 많이 겹치는 자리로(덜 옮기는 쪽 먼저).
 *   앞 소절보다 앞으로, 뒤 소절을 넘어서는 가지 않는다 — 가사 차례는 그대로
 * - 어디로 옮겨도 절반도 겹치지 않으면 부르지 않는 가사다 — 걷는다
 */

import type { KaraokeSyl } from "@/lib/karaokeSyllables";

export interface VocalMap {
  /** 음마다의 시작(초) — 지금은 쓰지 않고 구간만 쓴다 */
  onsets: number[];
  /** 소리 내어 부르는 구간 [시작, 끝] */
  segments: [number, number][];
}

/** 이보다 오래 쉬면 다른 소절 */
const PHRASE_GAP = 1.2;
/** 부르는 구간의 앞뒤 여유(초) — 첫 자음·끄는 끝 */
const TOL = 0.3;
/** 이만큼 겹치면 제자리 */
const KEEP_COVER = 0.6;
/** 옮겨도 이만큼 못 겹치면 부르지 않는 가사 */
const MIN_COVER = 0.5;
/** 이만큼까지만 옮긴다(초) — 한두 마디 어긋난 것을 바로잡을 만큼 */
const MAX_SHIFT = 6;

/** t가 부르는 구간(앞뒤 tol초 여유) 안인가 */
function inVoice(segs: [number, number][], t: number, tol: number): boolean {
  let lo = 0;
  let hi = segs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [a, b] = segs[mid];
    if (t < a - tol) hi = mid - 1;
    else if (t > b + tol) lo = mid + 1;
    else return true;
  }
  return false;
}

export function fitToVocal(syls: KaraokeSyl[], v: VocalMap): KaraokeSyl[] {
  const segs = v.segments;
  if (!syls.length || !segs?.length) return syls;

  /* 쉬는 곳과 가사 줄에서 소절을 나눈다. 쉼 없이 되풀이하는 줄(「할아버지와 수박」
     끝의 「코가 찡하도록」 세 번)을 한 소절로 보면, 부르지 않는 가운데 되풀이까지
     「대부분 부르는 구간 안」으로 셈해져 간주 중에 흘렀다 */
  const phrases: KaraokeSyl[][] = [];
  for (const s of [...syls].sort((a, b) => a.t - b.t)) {
    const cur = phrases[phrases.length - 1];
    const prev = cur?.[cur.length - 1];
    const sameLine = prev?.line === undefined || s.line === undefined || prev.line === s.line;
    if (prev && sameLine && s.t - prev.t <= PHRASE_GAP) cur.push(s);
    else phrases.push([s]);
  }

  const cover = (p: KaraokeSyl[], d: number) =>
    p.filter((s) => inVoice(segs, s.t + d, TOL)).length / p.length;

  const out: KaraokeSyl[] = [];
  let floor = -Infinity; // 앞 소절이 끝난 자리 — 이보다 앞으로는 못 간다
  phrases.forEach((p, k) => {
    const first = p[0].t;
    const last = p[p.length - 1].t;
    const next = phrases[k + 1]?.[0].t ?? Infinity; // 뒤 소절(제자리)을 넘지 않는다
    let best = 0;
    let bestCover = cover(p, 0);
    if (bestCover < KEEP_COVER) {
      for (let i = -MAX_SHIFT * 20; i <= MAX_SHIFT * 20; i++) {
        const d = i / 20;
        if (first + d <= floor || last + d >= next) continue;
        const c = cover(p, d);
        if (c > bestCover + 1e-9 || (Math.abs(c - bestCover) < 1e-9 && Math.abs(d) < Math.abs(best))) {
          best = d;
          bestCover = c;
        }
      }
    }
    if (bestCover < MIN_COVER) return; // 부르지 않는 가사 — 걷는다
    for (const s of p) out.push({ ...s, t: +(s.t + best).toFixed(3) });
    floor = last + best;
  });
  return out;
}
